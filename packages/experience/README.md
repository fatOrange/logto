# @logto/experience

The register and sign-in experience for end-users.

## Application sign-in layouts

Applications can select **Default** or **OneLayout** in Console under
**Applications → Branding → Login page layout**. The choice is independent of
the app-level branding switch and does not affect other applications.

OneLayout uses a split illustration layout for the sign-in entry page and a
centered card for registration. Existing authentication controls, social sign-in,
and inline WeChat QR sign-in are reused. Secondary authentication pages retain
their existing layout. The illustration is hidden on narrow screens.
OneLayout's full page uses a light `#fcfcfc` background matching branded
sign-in pages, with the existing dark theme colors applied under
`html[data-theme='dark']`.

Switching between sign-in and registration morphs the card and fades its contents
and illustration using native view transitions. Browsers without the View
Transitions API and users who prefer reduced motion switch immediately.

With developer features enabled, Console's **Sign-in experience → Branding**
live preview displays OneLayout. This preview-only override does not change
tenant settings or saved application layouts. Other preview tabs and the setup
guide retain their default layout.
The desktop OneLayout preview uses a 1280×900 viewport scaled to the existing
preview panel so the form and illustration are both visible. Mobile previews
retain their 390×844 viewport and single-column layout.

This development feature requires developer features to be enabled. Apply
database alterations before starting the updated backend:

```sh
pnpm cli db alteration deploy next
```

The application sign-in experience API accepts `layout: "OneLayout"`.
Send `layout: null` to restore the default; omit `layout` to preserve the saved
choice. When developer features are disabled, the experience uses the default
layout and non-null layout updates are rejected.

Production builds also require the flag in the Experience build process; setting
it only in the backend's `.env` does not enable the bundled frontend feature:

```sh
DEV_FEATURES_ENABLED=1 pnpm --filter @logto/experience build
```
