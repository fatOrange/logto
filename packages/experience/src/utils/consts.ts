export const layoutClassNames = Object.freeze({
  pageContainer: 'logto_page-container',
  mainContent: 'logto_main-content',
  customContent: 'logto_custom-content',
  brandingHeader: 'logto_branding-header',
});

/**
 * Global marker classes pairing OneLayout card children (heading, "OR" separator, social methods
 * list, account switch row) with view-transition names for the OneLayout (dev-only feature)
 * sign-in ↔ register transition. Consumed by `src/scss/view-transition.scss`, which scopes every
 * declaration under `html[data-one-layout-transition]` — set by
 * `use-one-layout-view-transition` only while a transition is active — so no other layout ever
 * snapshot-names an element.
 */
export const oneLayoutTransitionClassNames = Object.freeze({
  heading: 'logto-vt-heading',
  separator: 'logto-vt-separator',
  oauthMethods: 'logto-vt-oauth-methods',
  switchRow: 'logto-vt-switch-row',
});
