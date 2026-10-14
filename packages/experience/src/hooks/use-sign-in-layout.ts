import { SignInLayout } from '@logto/schemas';
import { useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import { isDevFeaturesEnabled } from '@/constants/env';

/**
 * Resolve the application-selected sign-in page layout.
 *
 * Dev-only feature: Application sign-in layouts. The selection is honored only when dev features
 * are enabled; an absent, `null`, or unknown value always resolves to `undefined`, which keeps the
 * default sign-in experience.
 */
const useSignInLayout = (): SignInLayout | undefined => {
  const { experienceSettings } = useContext(PageContext);

  if (!isDevFeaturesEnabled) {
    return undefined;
  }

  return experienceSettings?.layout === SignInLayout.OneLayout ? SignInLayout.OneLayout : undefined;
};

export default useSignInLayout;
