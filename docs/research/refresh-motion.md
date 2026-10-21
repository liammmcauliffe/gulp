# Refresh behavior

Checked 20 October 2026.

## References

- [Apple's progress-indicator guidance](https://developer.apple.com/design/human-interface-guidelines/progress-indicators) describes Mail's pull-to-refresh: an activity indicator is revealed above the content and disappears when the operation completes. It recommends keeping indicators in a consistent location and avoiding unnecessary labels.
- [Ionic's native refreshers](https://ionicframework.com/docs/api/refresher#native-refreshers) distinguish iOS's line spinner, whose ticks progressively appear during a pull, from Material's circular spinner. Its native iOS behavior depends on rubber-band scrolling.
- [Android's pull-to-refresh examples](https://developer.android.com/develop/ui/compose/components/pull-to-refresh) share refresh state between the content and its indicator, and demonstrate transitioning from gesture progress to an active loading indicator.

## Gulp's implementation

The native iOS-style segmented appearance was later replaced after feedback
that it did not fit Gulp's visual style. The current indicator is a white
arc with rounded ends over a faint circular track, matching the app's
monochrome controls. The arc fills as the pull approaches its threshold and
rotates once per second while loading. The content holds 64px of space below
the header. The indicator fades with the returning spring and continues
from its visible position if another pull interrupts the return. Reduced
motion removes rotation and spring travel.

Selecting Sports closes the player, returns to the top, and starts this same
refresh flow. Repeated selections share the active refresh. Manual refresh
also waits for any existing automatic schedule request, preventing the
spinner from disappearing while that request is still running.

Validation: syntax checks and 33 tests passed, including partial arc reveal,
release velocity, interruption, reduced motion, Sports navigation, duplicate
refresh requests, and sharing an existing load. A browser preview with a
simulated slow refresh confirmed scroll-to-top and the indicator clearing
after completion.
