#import <AppKit/AppKit.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

// Only ownership metadata is polled. Clipboard data stays in the existing
// renderer pipeline and is read once after a change, at the same 300ms cadence.
static void observeCount(int64_t count, int64_t *previous, bool *initialized) {
    if (*initialized && count == *previous) return;
    *initialized = true;
    *previous = count;
    puts("CLIPBOARD_CHANGE");
    fflush(stdout);
}

int main(void) {
    int64_t previous = 0;
    bool initialized = false;
#ifdef EZCLIPBOARD_SEQUENCE_TEST
    // The test build exercises the production gate without reading clipboard
    // contents or changing the user's pasteboard.
    long long count;
    while (scanf("%lld", &count) == 1) observeCount(count, &previous, &initialized);
    return 0;
#else
    for (;;) {
        @autoreleasepool {
            observeCount((int64_t)[NSPasteboard generalPasteboard].changeCount,
                         &previous, &initialized);
        }
        usleep(300000);
    }
#endif
}
