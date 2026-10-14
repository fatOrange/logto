import {
  AgreeToTermsPolicy,
  experience,
  ExtraParamsKey,
  SignInLayout,
  SignInMode,
} from '@logto/schemas';
import classNames from 'classnames';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';

import LandingPageLayout from '@/Layout/LandingPageLayout';
import OneLayout from '@/Layout/OneLayout';
import SingleSignOnFormModeContextProvider from '@/Providers/SingleSignOnFormModeContextProvider';
import SingleSignOnFormModeContext from '@/Providers/SingleSignOnFormModeContextProvider/SingleSignOnFormModeContext';
import WebAuthnContextProvider from '@/Providers/WebAuthnContextProvider';
import PasskeySignInButton from '@/components/Button/PasskeySignInButton';
import Divider from '@/components/Divider';
import GoogleOneTap from '@/components/GoogleOneTap';
import TextLink from '@/components/TextLink';
import SocialSignInList from '@/containers/SocialSignInList';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import TermsAndPrivacyLinks from '@/containers/TermsAndPrivacyLinks';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useOneLayoutViewTransition from '@/hooks/use-one-layout-view-transition';
import { useSieMethods } from '@/hooks/use-sie';
import useSignInLayout from '@/hooks/use-sign-in-layout';
import useTerms from '@/hooks/use-terms';
import { oneLayoutTransitionClassNames } from '@/utils/consts';

import ErrorPage from '../ErrorPage';

import Main from './Main';
import styles from './index.module.scss';

const SignInFooters = () => {
  const { t } = useTranslation();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();
  const { handleAccountSwitchClick } = useOneLayoutViewTransition();
  /**
   * OneLayout (dev-only feature: Application sign-in layouts) presents the account switch below
   * the social sign-in list; the default layout keeps the existing order.
   */
  const isOneLayout = useSignInLayout() === SignInLayout.OneLayout;

  const {
    signInMethods,
    signUpMethods,
    socialConnectors,
    signInMode,
    singleSignOnEnabled,
    passkeySignIn,
  } = useSieMethods();

  const { showSingleSignOnForm } = useContext(SingleSignOnFormModeContext);

  const handleSsoNavigation = useCallback(async () => {
    /**
     * Check if the user has agreed to the terms and privacy policy before navigating to the SSO page
     * when the policy is set to `Manual`
     */
    if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
      return;
    }
    navigate('/single-sign-on/email');
  }, [agreeToTermsPolicy, navigate, termsValidation]);

  /* Hide footers when showing Single Sign On form */
  if (showSingleSignOnForm) {
    return null;
  }

  return (
    <>
      {
        // Single Sign On footer
        singleSignOnEnabled && (
          <>
            <div className={styles.singleSignOn}>
              {t('description.use')}{' '}
              <TextLink text="action.single_sign_on" onClick={handleSsoNavigation} />
            </div>
            {
              /**
               * If only SSO sign-in methods are available, display the agreement checkbox when the agreement policy is `Manual`.
               */
              signInMethods.length === 0 &&
                socialConnectors.length === 0 &&
                agreeToTermsPolicy === AgreeToTermsPolicy.Manual && (
                  <TermsAndPrivacyCheckbox className={styles.checkboxForSsoOnly} />
                )
            }
          </>
        )
      }
      {
        // Create Account footer (rendered below the social list in OneLayout)
        !isOneLayout && signInMode === SignInMode.SignInAndRegister && signUpMethods.length > 0 && (
          <div className={styles.createAccount}>
            {t('description.no_account')}{' '}
            <TextLink replace to="/register" text="action.create_account" />
          </div>
        )
      }
      {
        // Social sign-in methods
        signInMethods.length > 0 && socialConnectors.length > 0 && (
          <>
            <Divider
              label="description.or"
              className={classNames(styles.divider, oneLayoutTransitionClassNames.separator)}
            />
            <SocialSignInList
              socialConnectors={socialConnectors}
              className={classNames(styles.main, oneLayoutTransitionClassNames.oauthMethods)}
            />
          </>
        )
      }
      {passkeySignIn?.enabled && passkeySignIn.showPasskeyButton && <PasskeySignInButton />}
      {
        // OneLayout presents the account switch below the social sign-in methods
        isOneLayout && signInMode === SignInMode.SignInAndRegister && signUpMethods.length > 0 && (
          <div
            className={classNames(styles.createAccount, oneLayoutTransitionClassNames.switchRow)}
          >
            {t('description.no_account')}{' '}
            <TextLink
              replace
              to="/register"
              text="action.create_account"
              onClick={(event) => {
                handleAccountSwitchClick(event, '/register');
              }}
            />
          </div>
        )
      }
    </>
  );
};

const SignIn = () => {
  const { signInMethods, socialConnectors, signInMode } = useSieMethods();
  const { agreeToTermsPolicy } = useTerms();
  const [params] = useSearchParams();
  const layout = useSignInLayout();

  if (!signInMode) {
    return <ErrorPage />;
  }

  if (signInMode === SignInMode.Register) {
    return <Navigate to="/register" />;
  }

  if (params.get(ExtraParamsKey.OneTimeToken)) {
    return (
      <Navigate
        replace
        to={{ pathname: `/${experience.routes.oneTimeToken}`, search: `?${params.toString()}` }}
      />
    );
  }

  const cardContent = (
    <>
      <GoogleOneTap context="signin" />
      <WebAuthnContextProvider>
        <SingleSignOnFormModeContextProvider>
          <Main signInMethods={signInMethods} socialConnectors={socialConnectors} />
          <SignInFooters />
        </SingleSignOnFormModeContextProvider>
      </WebAuthnContextProvider>
    </>
  );

  const termsContent =
    // Only show terms and privacy links for sign in page if the agree to terms policy is `Automatic` or `ManualRegistrationOnly`
    agreeToTermsPolicy === AgreeToTermsPolicy.Manual ? null : (
      <TermsAndPrivacyLinks className={styles.terms} />
    );

  if (layout === SignInLayout.OneLayout) {
    // OneLayout keeps the header above the card and the legal text outside of it.
    return (
      <OneLayout
        hasIllustration
        title="description.sign_in_to_your_account"
        card={cardContent}
        footer={termsContent}
      />
    );
  }

  return (
    <LandingPageLayout title="description.sign_in_to_your_account">
      {cardContent}
      {termsContent}
    </LandingPageLayout>
  );
};

export default SignIn;
