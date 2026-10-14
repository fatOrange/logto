import { z } from 'zod';

/**
 * The layout of the sign-in and registration pages for an application.
 *
 * Each app can select its login page layout in Console. `null`/absent means the default
 * layout; a value overrides the rendered layout for this application only and is never
 * inherited from another app.
 */
export enum SignInLayout {
  /** The split-illustration auth shell for the sign-in and registration first screens. */
  OneLayout = 'OneLayout',
}

export const signInLayoutGuard = z.nativeEnum(SignInLayout);
