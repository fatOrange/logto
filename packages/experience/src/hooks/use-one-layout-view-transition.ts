import { SignInLayout } from '@logto/schemas';
import { type MouseEvent, useCallback, useContext } from 'react';
import { flushSync } from 'react-dom';
import { type To } from 'react-router-dom';

import PageContext from '@/Providers/PageContextProvider/PageContext';

import useNavigateWithPreservedSearchParams from './use-navigate-with-preserved-search-params';
import useSignInLayout from './use-sign-in-layout';

const transitionAttribute = 'data-one-layout-transition';

/**
 * Reference count for the `html[data-one-layout-transition]` marker. The marker is what scopes
 * the view-transition-name declarations, so it must stay set while ANY transition is settling —
 * including after the OneLayout instance that started one unmounts during the route commit
 * (a component-level cleanup would strip the marker mid-transition). A rapid second click
 * stacks transitions; the browser skips the superseded one and its `finished` promise settles,
 * decrementing the count without stripping the marker under the newer transition.
 */
/* eslint-disable-next-line @silverhand/fp/no-let --
   Imperative module-level counter for the document marker lifetime (see docblock); it is not
   component state and a ref-based abstraction would not outlive the owning component either. */
let activeTransitionCount = 0;

const setActiveTransition = (isActive: boolean) => {
  /* eslint-disable-next-line @silverhand/fp/no-mutation --
     Mutation of the module-level marker counter described above; confined to these two
     functions so the marker lifecycle stays auditable in one place. */
  activeTransitionCount = Math.max(0, activeTransitionCount + (isActive ? 1 : -1));

  if (activeTransitionCount === 0) {
    document.documentElement.removeAttribute(transitionAttribute);
  } else {
    document.documentElement.setAttribute(transitionAttribute, '');
  }
};

/**
 * OneLayout (dev-only feature: Application sign-in layouts) sign-in ↔ register view transition.
 *
 * React Router 6.30 here runs a declarative `<BrowserRouter>`, so its data-router-only
 * `viewTransition` prop is unavailable; the seam is `document.startViewTransition` around a
 * synchronous route commit (`flushSync`), exactly like the WorkOS AuthKit reference. Motion is
 * declared in `src/scss/view-transition.scss` against the OneLayout transition markers.
 *
 * The experience preview pane (`?preview=true`) must keep its query across the switch, otherwise
 * `PageContext.isPreview` flips and `SettingsProvider` swaps the hook it calls, crashing React.
 * Therefore every plain (no-transition) path in this handler navigates to an explicit
 * `{ pathname, search }` object that re-adds `preview=true`; the helper itself is unchanged, so
 * unsupported browsers and reduced-motion users still land in preview with `app_id` preserved.
 *
 * The returned handler only `preventDefault()`s plain, unmodified left clicks while this layout
 * is active, so modifier-click open-in-new-tab, target/download links, and the router's own
 * handling stay untouched.
 */
const useOneLayoutViewTransition = () => {
  const navigateWithPreservedSearchParams = useNavigateWithPreservedSearchParams();
  const isOneLayout = useSignInLayout() === SignInLayout.OneLayout;
  const { isPreview } = useContext(PageContext);

  const handleAccountSwitchClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, to: To) => {
      if (
        !isOneLayout ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      // Modifier-click and default-layout semantics are unchanged; the preview query is only
      // re-added on the paths this handler owns.
      const target: To = isPreview ? { pathname: String(to), search: 'preview=true' } : to;

      if (
        !document.startViewTransition ||
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      ) {
        // Unsupported browsers and reduced-motion users: navigate once through the shared
        // helper (which still preserves `app_id`) without any transition.
        event.preventDefault();
        navigateWithPreservedSearchParams(target, { replace: true });
        return;
      }

      event.preventDefault();
      setActiveTransition(true);
      // The new scene must be committed before the browser captures the "new" snapshot;
      // React 18 batches route updates, so the commit needs an explicit synchronous flush.
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          navigateWithPreservedSearchParams(target, { replace: true });
        });
      });
      // `finished` settles even when the transition is skipped or fails after the DOM update;
      // always release the marker so no stale state lingers on the document element.
      const releaseMarker = async () => {
        try {
          await transition.finished;
        } catch {
          // The swap failure already applied; nothing to recover here.
        } finally {
          setActiveTransition(false);
        }
      };
      void releaseMarker();
    },
    [isOneLayout, isPreview, navigateWithPreservedSearchParams]
  );

  return { handleAccountSwitchClick };
};

export default useOneLayoutViewTransition;
