/* SPDX-License-Identifier: AGPL-3.0-only
 * Native Debian entry point. Electron and its runtime stay together under /opt.
 * execv forwards arguments without a shell and preserves signals and exit status.
 */
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifndef DISKMOSAIC_EXECUTABLE
#error "DISKMOSAIC_EXECUTABLE must name the packaged application executable"
#endif

int main(int argc, char **argv) {
    (void)argc;
    argv[0] = (char *)DISKMOSAIC_EXECUTABLE;
    execv(DISKMOSAIC_EXECUTABLE, argv);
    const int error = errno;
    fprintf(stderr, "Could not start DiskMosaic: %s\n", strerror(error));
    return error == ENOENT ? 127 : 126;
}
