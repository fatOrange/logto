import {
  type ApplicationSignInExperience,
  type CreateApplicationSignInExperience,
} from '@logto/schemas';

import { removeFalsyValues } from '@/utils/object';

export type ApplicationSignInExperienceForm = Omit<ApplicationSignInExperience, 'layout'> & {
  /**
   * The app-level sign-in page layout choice. `undefined` means the field is absent (Console dev
   * features disabled) and saves must omit it; `null` means the default layout (cleared choice).
   */
  layout?: ApplicationSignInExperience['layout'];
  /**
   * Used to determine if the application enables branding for the app-level sign-in experience.
   * Only effective for non-third-party applications.
   */
  isBrandingEnabled: boolean;
};

/**
 * Format the form data to match the API request body
 * - Omit `applicationId` and `tenantId` from the request body
 * - Remove the empty `logoUrl` and `darkLogoUrl` fields in the `branding` object
 **/
export const formatFormToSubmitData = (
  data: ApplicationSignInExperienceForm
): Omit<CreateApplicationSignInExperience, 'applicationId' | 'tenantId'> => {
  const {
    branding,
    color,
    customCss,
    applicationId,
    tenantId,
    isBrandingEnabled,
    layout,
    ...rest
  } = data;

  return {
    ...rest,
    // The sign-in layout choice is independent of the app-level branding switch. Preserve it on
    // every save, including an explicit `null` for the default layout. When the field is absent
    // (dev features disabled or an older API response), omit it so the saved value is untouched.
    ...(layout !== undefined && { layout }),
    ...(isBrandingEnabled
      ? { color, branding: removeFalsyValues(branding), customCss }
      : { color: {}, branding: {}, customCss: '' }),
  };
};
