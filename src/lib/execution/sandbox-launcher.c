/*
 * labsubmit-sandbox — run a student program with no network and a reduced syscall surface.
 *
 * Usage: labsubmit-sandbox <program> [args...]
 *
 * Installs a seccomp-BPF filter on itself (unprivileged: PR_SET_NO_NEW_PRIVS first), then
 * exec()s the program. The filter is inherited by every child and survives exec, so nothing
 * the student starts can lift it. It needs NO capabilities, no user namespaces and no
 * iptables — which is why it works inside an ordinary PaaS container (Railway), where
 * network namespaces and firewall rules are not available to the app.
 *
 * Policy (errno EPERM unless noted):
 *   - socket(): only AF_UNIX allowed (local pipes some runtimes use); AF_INET, AF_INET6,
 *     AF_NETLINK, AF_PACKET, ... refused  →  no network, no raw sockets, no netlink.
 *   - io_uring_*: refused — io_uring can perform socket I/O without the socket() syscall,
 *     i.e. it would bypass this filter.
 *   - Escape / interference: ptrace, process_vm_readv/writev, mount, umount2, pivot_root,
 *     chroot, unshare, setns, bpf, perf_event_open, userfaultfd, keyctl, add_key,
 *     request_key, kexec_load, init_module, finit_module, delete_module, reboot,
 *     swapon, swapoff, acct.
 *   - Wrong architecture (e.g. 32-bit int 0x80 on x86_64) or x32 syscalls: process killed —
 *     otherwise the same calls under other numbers would slip past the filter.
 *
 * Built at image build time (see Dockerfile). Linux only. Header-free on purpose: the seccomp
 * ABI constants are defined below so it builds with plain musl/glibc + gcc.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

/* ---- seccomp / BPF ABI (from linux/seccomp.h, linux/filter.h, linux/audit.h) ---- */
struct sock_filter { uint16_t code; uint8_t jt; uint8_t jf; uint32_t k; };
struct sock_fprog { unsigned short len; struct sock_filter *filter; };
struct seccomp_data { int nr; uint32_t arch; uint64_t instruction_pointer; uint64_t args[6]; };

#define BPF_LD 0x00
#define BPF_W 0x00
#define BPF_ABS 0x20
#define BPF_JMP 0x05
#define BPF_JEQ 0x10
#define BPF_JGE 0x30
#define BPF_K 0x00
#define BPF_RET 0x06
#define BPF_STMT(code, k) { (uint16_t)(code), 0, 0, (uint32_t)(k) }
#define BPF_JUMP(code, k, jt, jf) { (uint16_t)(code), (uint8_t)(jt), (uint8_t)(jf), (uint32_t)(k) }

#define SECCOMP_MODE_FILTER 2
#define SECCOMP_RET_KILL_PROCESS 0x80000000U
#define SECCOMP_RET_ERRNO 0x00050000U
#define SECCOMP_RET_ALLOW 0x7fff0000U
#ifndef PR_SET_NO_NEW_PRIVS
#define PR_SET_NO_NEW_PRIVS 38
#endif
#ifndef PR_SET_SECCOMP
#define PR_SET_SECCOMP 22
#endif

#if defined(__x86_64__)
#define LS_ARCH 0xc000003eU /* AUDIT_ARCH_X86_64 */
#define LS_X32_BIT 0x40000000U
#elif defined(__aarch64__)
#define LS_ARCH 0xc00000b7U /* AUDIT_ARCH_AARCH64 */
#else
#error "labsubmit-sandbox supports x86_64 and aarch64 only"
#endif

#define DENY(nr) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (nr), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

static struct sock_filter filter[] = {
    /* Architecture: anything but the native ABI is killed. */
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, LS_ARCH, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef LS_X32_BIT
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, LS_X32_BIT, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
    /* socket(domain, ...): allow only AF_UNIX. */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AF_UNIX, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    DENY(__NR_io_uring_setup),
    DENY(__NR_io_uring_enter),
    DENY(__NR_io_uring_register),
    DENY(__NR_ptrace),
    DENY(__NR_process_vm_readv),
    DENY(__NR_process_vm_writev),
    DENY(__NR_mount),
    DENY(__NR_umount2),
    DENY(__NR_pivot_root),
    DENY(__NR_chroot),
    DENY(__NR_unshare),
    DENY(__NR_setns),
    DENY(__NR_bpf),
    DENY(__NR_perf_event_open),
    DENY(__NR_userfaultfd),
    DENY(__NR_keyctl),
    DENY(__NR_add_key),
    DENY(__NR_request_key),
    DENY(__NR_kexec_load),
    DENY(__NR_init_module),
    DENY(__NR_finit_module),
    DENY(__NR_delete_module),
    DENY(__NR_reboot),
    DENY(__NR_swapon),
    DENY(__NR_swapoff),
    DENY(__NR_acct),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
};

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: labsubmit-sandbox <program> [args...]\n");
    return 2;
  }
  struct sock_fprog prog = { (unsigned short)(sizeof(filter) / sizeof(filter[0])), filter };
  /* Fail closed: if the filter cannot be installed, the program is NOT run. */
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    fprintf(stderr, "labsubmit-sandbox: PR_SET_NO_NEW_PRIVS failed: %s\n", strerror(errno));
    return 126;
  }
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog, 0, 0) != 0) {
    fprintf(stderr, "labsubmit-sandbox: seccomp filter not installed: %s\n", strerror(errno));
    return 126;
  }
  execvp(argv[1], argv + 1);
  fprintf(stderr, "labsubmit-sandbox: cannot execute %s: %s\n", argv[1], strerror(errno));
  return 127;
}
