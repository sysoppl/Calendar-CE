export interface PublicConfig {
  /** Public address of the web app without a trailing slash. */
  appUrl: string;
}

export function resolvePublicConfig(env?: Record<string, string | undefined>): PublicConfig;

/** Links the app shows; an empty one is not set and not shown. */
export interface AppLinks {
  /** VITE_PRIVACY_URL: the privacy policy. */
  privacy: string;
  /** VITE_TERMS_URL: the terms of service. */
  terms: string;
  /** VITE_CONTACT_URL: a contact or imprint page, or a mailto: address. */
  contact: string;
}

export function resolveLinks(env?: Record<string, string | undefined>): AppLinks;
export const publicConfig: PublicConfig;
export const appUrl: string;
