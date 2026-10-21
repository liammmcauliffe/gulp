# Berd cursor implementation

Inspected 19 October 2026. Source: [berd.xyz](https://berd.xyz/), its public production assets, and the CSS blending specification. This note describes the deployed website cursor, not the Berd desktop application's cursor.

## What the production code actually does

**The main cursor is one HTML `div`, moved directly on each `pointermove`. There is no interpolation, spring, trail, canvas, SVG filter, or shader in its movement/rendering path.** The size and visibility animate through CSS; its position does not. The relevant implementation is already readable in [script.js, lines 6–43](https://berd.xyz/sites/berd/script.js) and [styles.css, lines 98–118](https://berd.xyz/sites/berd/styles.css).

| Detail | Verified production value |
| --- | --- |
| Element | `<div class="custom-cursor" aria-hidden="true"></div>` |
| Position | `fixed`, `top: 0`, `left: 0`, `z-index: 9999` |
| Default size | 16 × 16 CSS pixels |
| Interactive hover size | 21.6 × 21.6 CSS pixels, a 1.35× enlargement |
| Shape | Rounded square, `border-radius: 3px` |
| Fill and blend | White, `mix-blend-mode: difference` |
| Movement | Client coordinates, translated in 3D and centered using `translate(-50%, -50%)` |
| Transitions | Width and height: 140 ms `ease`; opacity: 120 ms `ease` |
| Input handling | Passive `pointermove` listener on `window` |
| Hit testing | `pointer-events: none`, so the overlay cannot intercept the page's controls |
| Availability | Initializes only when `(pointer: fine)` matches |
| Native cursor | Hidden after initialization with `html.has-custom-cursor * { cursor: none !important; }` |
| Visibility | Initially transparent and offscreen; appears on movement/entry, disappears on document exit |

The element is in the HTML template embedded in [the production entry bundle](https://berd.xyz/assets/sites-DP2vDxy9.js), line 6. That bundle's site loader at line 456 loads the readable Berd CSS and JavaScript. The numerical behavior and styles in the table come from the two readable files linked above. The CSS comment calls the pointer a “circle,” but the active declaration is `border-radius: 3px`; use the declaration as the source of truth.

Hover targets are the nearest ancestor matching `a, button, input, textarea, select, summary, [role="button"]` (`script.js`, line 9). Delegated `pointerover` grows the cursor; `pointerout` checks `relatedTarget` before shrinking it (`script.js`, lines 34–40). Moving between descendants of one control, or straight between two interactive controls, therefore keeps the larger size. This implementation has no additional press deformation, magnetic attraction, text caret replacement, or target-shaped morph in its main cursor function.

## Why it seems to change color

The source uses a constant white fill. Color adaptation comes from CSS `difference`, whose per-channel formula is the absolute difference between the backdrop and source color. White produces the inverse of the backdrop: approximately black on white, white on black, and an inverse color over a colored element. This follows from the declared style and the [W3C difference blending formula](https://www.w3.org/TR/compositing-1/#blendingdifference); it is not a JavaScript color-sampling operation.

That explains the effect over text, images, and moving video. It changes the pixels beneath its shape without displacing them. It does not create refraction, magnification, blur, or a liquid surface.

## Small reusable implementation

The following is a compact reimplementation using the verified production parameters. It omits the site's footer iframe integration. The selectors and function structure are written here for reuse; this is not the entire downloaded source.

```html
<div id="custom-pointer" aria-hidden="true"></div>
```

```css
#custom-pointer {
  position: fixed;
  inset: 0 auto auto 0;
  z-index: 9999;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: white;
  mix-blend-mode: difference;
  pointer-events: none;
  opacity: 0;
  transform: translate3d(-100px, -100px, 0) translate(-50%, -50%);
  transition: width 140ms ease, height 140ms ease, opacity 120ms ease;
}
@media (pointer: fine) {
  html.custom-pointer-ready,
  html.custom-pointer-ready * { cursor: none !important; }
}
```

```js
const pointer = document.querySelector('#custom-pointer');
const controls = 'a, button, input, textarea, select, summary, [role="button"]';
const isControl = node => node instanceof Element && !!node.closest(controls);

if (pointer && matchMedia('(pointer: fine)').matches) {
  document.documentElement.classList.add('custom-pointer-ready');
  const setHover = active => {
    const diameter = active ? '21.6px' : '16px';
    pointer.style.width = diameter;
    pointer.style.height = diameter;
  };
  window.addEventListener('pointermove', ({ clientX: x, clientY: y }) => {
    pointer.style.opacity = '1';
    pointer.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  }, { passive: true });
  document.addEventListener('pointerenter', () => pointer.style.opacity = '1');
  document.addEventListener('pointerleave', () => pointer.style.opacity = '0');
  document.addEventListener('pointerover', event => {
    if (isControl(event.target)) setHover(true);
  });
  document.addEventListener('pointerout', event => {
    if (!isControl(event.relatedTarget)) setHover(false);
  });
}
```

Place the overlay alongside the page content near the document root. Keep the actual content in the blending backdrop: an isolated empty overlay wrapper can prevent it from blending with the content beneath that wrapper. The specification explains [blending within stacking contexts](https://www.w3.org/TR/compositing-1/#htmlbehavior) and [isolation](https://www.w3.org/TR/compositing-1/#isolation).

An isolated, dependency-free [working example](../../artifacts/berd-cursor-demo.html) is saved in `artifacts/berd-cursor-demo.html`. Open it directly in a browser, or use the [running local preview](http://localhost:4174/berd-cursor-demo.html) while the preview server is running. Browser checks confirmed the 16 px base size, approximately 21.6 px on controls (fractional CSS pixels are quantized by the browser), direct positioning, difference blending, and working button/text-field interaction. The example adds a reduced-motion preference and hides the overlay when the window loses focus. A [preview screenshot](../../artifacts/berd-cursor-demo.jpg) captures the result.

## Footer iframe

The strawberry footer is a separate document. Its [embed.html, lines 21–64](https://berd.xyz/sites/berd/assets/gloopie-goo/embed.html) implements a second local cursor with the same 16 px square, 3 px corner radius, white difference blend, and direct pointer positioning. Its cursor has `z-index: 100` and only the 120 ms opacity transition. Presence messages hide the main page cursor when the pointer is inside the iframe; coordinates remain local. The author's comments explicitly say earlier cross-frame coordinate messaging caused visible jitter, especially in Safari. That performance history is an author comment, not a benchmark independently reproduced in this research.

## Applying the effect to Gulp

The reference was applied to Gulp on 19 October 2026: the TV now uses Berd's
rounded square, difference blending, and virtual-pointer control hit testing.
The old glass renderer and its dependency were removed. The guidance below
records the Gulp implementation before that replacement; its glass-file links
and line numbers describe that earlier snapshot.

- Preserve the phone/WebSocket/projection input path in [`public/screen.js`](../../public/screen.js). Its `draw()` currently interpolates toward the phone position with factor `.45` per frame (lines 29–40). Berd's direct mouse movement does not mean sensor smoothing should be removed.
- Replace the glass appearance with a white difference-blended shape, optionally retaining Gulp's circular form via `border-radius: 50%`. The 26 px ring and its pseudo-element are in [`public/style.css`](../../public/style.css), lines 9–10. The WebGL glass setup is in [`public/glass.js`](../../public/glass.js), lines 16–29; it is a different rendering effect and would need to be disabled for a faithful difference-pointer mode.
- The current `draw()` uses **top-left** coordinates and subtracts the 26 px pointer dimension from the viewport size. Berd uses **center** coordinates. Account for that difference when changing diameter or adding the centering transform; otherwise the virtual pointer and its hit position will be offset.
- A phone-driven virtual pointer does not generate DOM mouse/pointer hover. For equivalent enlargement, hit-test its viewport center with `document.elementFromPoint(x, y)`, then apply the same nearest-control selector and size state. This is implementation guidance inferred from the current app's coordinate-driven rendering, not behavior found in Berd's source.
- Blend against the actual page content. On Gulp's current black dotted canvas this produces a white cursor whose overlap with white dots turns dark; it will not look like clear refracting glass.

## Source capture and limits

Public files were fetched to `/tmp/berd-cursor-research`; full third-party bundles were not added to this project. These hashes identify the readable assets inspected:

```text
script.js   SHA-256 348a9d2aac03af253e2e57e782084153b7fc9326fd2c904204c0ee7e6f5f3baa
styles.css  SHA-256 a08bc62f5ce36af692eb1cc6caf0898dd3891d313e15d2f1eb2738c00dd7842f
embed.html  SHA-256 53a2775b8b6c3bdf0a75ff5f71ffb2a2cfcacbe6e04fac218b69a5cf2b298cdc
```

The production entry bundle did not advertise a source map; requesting the corresponding `.js.map` URL returned HTTP 404. Source maps were unnecessary for the cursor because its active implementation is served as readable JavaScript and CSS. Asset URLs and line numbers describe the captured deployment and may change when the site is updated. The GitHub link on the site points to the Berd application; this investigation does not establish that the website's assets share that repository's license.
