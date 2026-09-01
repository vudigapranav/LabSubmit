'use client';

import { useEffect, useState } from 'react';
import type { DeviceClass } from './deviceEligibility';

// Client-side companion to deviceEligibility.ts. Its only job is to volunteer a hint the
// server cannot work out on its own — chiefly iPadOS 13+, which sends a desktop Safari
// User-Agent by design and is otherwise indistinguishable from a Mac.
//
// This is NOT the enforcement point. The server decides, and it only ever accepts this
// hint in the stricter direction, so nothing here can unlock an exam on a phone.

export function detectClientDeviceClass(): DeviceClass {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'UNKNOWN';

  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;

  if (/iphone|ipod|android.*mobile|windows phone|iemobile|blackberry|opera mini/i.test(ua)) {
    return 'MOBILE';
  }
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua)) {
    return 'TABLET';
  }
  // iPadOS 13+ masquerading as macOS: a real Mac reports 0 touch points.
  if (/macintosh/i.test(ua) && touchPoints > 1) {
    return 'TABLET';
  }
  // A touch-primary device with a small viewport that dodged every UA pattern.
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  if (coarsePointer && touchPoints > 0 && Math.min(window.screen.width, window.screen.height) < 768) {
    return 'MOBILE';
  }

  return 'DESKTOP';
}

/** Sent as the X-LabSubmit-Device-Class header on exam requests. */
export function deviceHintHeaders(): Record<string, string> {
  const cls = detectClientDeviceClass();
  return cls === 'UNKNOWN' ? {} : { 'X-LabSubmit-Device-Class': cls };
}

/**
 * Viewport-based advisory used purely for presentation — showing the "use a computer"
 * notice before the student even clicks Start. Recomputed on resize, unlike the
 * device-class hint, which is a property of the hardware rather than the window.
 */
export function useDeviceClass(): { deviceClass: DeviceClass; viewportTooSmall: boolean } {
  const [deviceClass, setDeviceClass] = useState<DeviceClass>('UNKNOWN');
  const [viewportTooSmall, setViewportTooSmall] = useState(false);

  useEffect(() => {
    setDeviceClass(detectClientDeviceClass());

    const measure = () => setViewportTooSmall(window.innerWidth < 1024);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return { deviceClass, viewportTooSmall };
}
