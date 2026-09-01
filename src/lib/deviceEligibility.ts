// Exam-device restriction.
//
// The platform as a whole is mobile-friendly — dashboards, notices, results and
// instructions must stay reachable from a phone. An ACTIVE EXAMINATION ATTEMPT is the
// exception: it may only be started and continued from a desktop-class device.
//
// This module classifies the device from REQUEST HEADERS, so the decision is made on the
// server and survives a tampered or scripted client. A client-supplied hint is accepted
// only in the direction that makes the check STRICTER (see `applyClientHint`) — a client
// can volunteer "I am a tablet" and be blocked, but can never talk its way into being
// treated as a desktop.
//
// Pure module, no prisma import — usable from route handlers, the WebSocket execution
// layer, and client components alike (mirroring examTiming.ts / examIntegrity.ts).

export type DeviceClass = 'DESKTOP' | 'TABLET' | 'MOBILE' | 'UNKNOWN';

/**
 * START  — gating the transition into an active attempt (the "Start Exam" click).
 *          Fails closed: an unclassifiable device is refused, because every real browser
 *          sends a User-Agent and a stripped one is the shape a bypass attempt takes.
 * CONTINUE — every action inside an attempt already under way (saving, running code,
 *          submitting). Blocks only a positively identified phone/tablet, so a student
 *          mid-exam can never be locked out of their own paper by an odd header.
 */
export type DeviceCheckPhase = 'START' | 'CONTINUE';

/** The message a student sees on a phone or tablet. Single source of truth. */
export const UNSUPPORTED_DEVICE_MESSAGE =
  'LabSubmit examinations must be attempted on a laptop or desktop computer. Please switch to a supported device to continue.';

/**
 * Shown when the device cannot be classified at all. Kept distinct from the message above
 * because the remedy differs: the student is not necessarily on a phone, their browser is
 * withholding the information the check needs.
 */
export const UNIDENTIFIED_DEVICE_MESSAGE =
  'LabSubmit could not identify this device, so the examination cannot be started here. Please use a standard desktop browser (Chrome, Edge, Firefox or Safari) without any user-agent modification.';

export interface DeviceSignals {
  userAgent: string | null;
  /** Sec-CH-UA-Mobile: "?1" on mobile, "?0" otherwise. Chromium-family only. */
  uaMobileHint: string | null;
  /** Sec-CH-UA-Platform: e.g. "Android", "Windows", "macOS", "iOS". */
  uaPlatformHint: string | null;
  /** Client-volunteered class. Only ever used to narrow eligibility. */
  clientHint: string | null;
}

export interface DeviceEligibility {
  deviceClass: DeviceClass;
  eligible: boolean;
  /** Student-facing explanation; safe to render directly. */
  reason: string;
  userAgent: string | null;
}

const MOBILE_UA = /iphone|ipod|android.*mobile|windows phone|iemobile|blackberry|bb10|opera mini|mobi\//i;
const TABLET_UA = /ipad|tablet|playbook|silk|kindle|nexus (?:7|9|10)|sm-t|android(?!.*mobile)/i;

// Headers are read through this indirection because the value arrives from three
// different shapes across the app: a fetch Request (route handlers), a Node
// IncomingMessage (the WebSocket upgrade), and a plain object (tests).
export type HeaderReader = (name: string) => string | null;

export function headerReaderFromRequest(req: Request): HeaderReader {
  return (name) => req.headers.get(name);
}

export function headerReaderFromNodeHeaders(headers: Record<string, string | string[] | undefined> | undefined): HeaderReader {
  return (name) => {
    if (!headers) return null;
    const value = headers[name.toLowerCase()];
    if (value === undefined) return null;
    return Array.isArray(value) ? value[0] ?? null : value;
  };
}

export function readDeviceSignals(getHeader: HeaderReader, clientHint?: string | null): DeviceSignals {
  return {
    userAgent: getHeader('user-agent'),
    uaMobileHint: getHeader('sec-ch-ua-mobile'),
    uaPlatformHint: getHeader('sec-ch-ua-platform'),
    clientHint: clientHint ?? getHeader('x-labsubmit-device-class'),
  };
}

export function classifyDevice(signals: DeviceSignals): DeviceClass {
  const ua = (signals.userAgent || '').trim();

  // Client hints are the most reliable signal where they exist, and Chromium sends them
  // on Android before anything in the UA string has to be pattern-matched.
  const platform = (signals.uaPlatformHint || '').replace(/"/g, '').toLowerCase();
  if (signals.uaMobileHint === '?1') {
    // A phone-sized Chromium reports ?1; Android tablets report ?0. Trust it for MOBILE.
    return 'MOBILE';
  }

  if (!ua) {
    // No UA at all: only a hint could tell us anything, and none did.
    return platform === 'android' || platform === 'ios' ? 'MOBILE' : 'UNKNOWN';
  }

  if (MOBILE_UA.test(ua)) return 'MOBILE';
  if (TABLET_UA.test(ua)) return 'TABLET';

  return 'DESKTOP';
}

/**
 * Narrow-only merge of the browser's own self-report. iPadOS 13+ deliberately sends a
 * desktop Safari User-Agent and is indistinguishable from a Mac server-side; the client
 * detects it (touch points on a "Mac") and volunteers TABLET. We honour that downgrade.
 * A hint claiming a LESS restricted class than the headers imply is discarded outright.
 */
export function applyClientHint(headerClass: DeviceClass, clientHint: string | null | undefined): DeviceClass {
  const hint = (clientHint || '').toUpperCase();
  if (hint !== 'MOBILE' && hint !== 'TABLET') return headerClass;
  if (headerClass === 'MOBILE') return headerClass; // already the strictest
  return hint as DeviceClass;
}

export function evaluateDeviceEligibility(
  signals: DeviceSignals,
  options: { requireDesktopDevice: boolean; phase: DeviceCheckPhase }
): DeviceEligibility {
  const deviceClass = applyClientHint(classifyDevice(signals), signals.clientHint);
  const { requireDesktopDevice, phase } = options;

  if (!requireDesktopDevice) {
    return { deviceClass, eligible: true, reason: '', userAgent: signals.userAgent };
  }

  if (deviceClass === 'MOBILE' || deviceClass === 'TABLET') {
    return {
      deviceClass,
      eligible: false,
      reason: UNSUPPORTED_DEVICE_MESSAGE,
      userAgent: signals.userAgent,
    };
  }

  if (deviceClass === 'UNKNOWN' && phase === 'START') {
    return {
      deviceClass,
      eligible: false,
      reason: UNIDENTIFIED_DEVICE_MESSAGE,
      userAgent: signals.userAgent,
    };
  }

  return { deviceClass, eligible: true, reason: '', userAgent: signals.userAgent };
}

/** Convenience wrapper for App Router route handlers. */
export function checkExamDevice(
  req: Request,
  lab: { requireDesktopDevice: boolean },
  phase: DeviceCheckPhase,
  clientHint?: string | null
): DeviceEligibility {
  const signals = readDeviceSignals(headerReaderFromRequest(req), clientHint);
  return evaluateDeviceEligibility(signals, { requireDesktopDevice: lab.requireDesktopDevice, phase });
}
