import { createAuth0Client } from "@auth0/auth0-spa-js";

export let accessToken;
export let useAuth;

export async function useAuthentication() {
  if (window.defaultConfig.useAuth) {
    useAuth = true;
  } else {
    useAuth = false;
  }
  if (useAuth) {
    const auth0Client = await createAuth0Client({
      domain: window.defaultConfig.auth_domain,
      clientId: window.defaultConfig.auth_clientId,
      cacheLocation: "localstorage",
      authorizationParams: {
        audience: window.defaultConfig.auth_audience,
        redirect_uri: window.location.origin,
      },
    });

    if (location.search.includes("state=") && (location.search.includes("code=") || location.search.includes("error="))) {
      await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, "/");
    }

    const isAuthenticated = await auth0Client.isAuthenticated();

    if (!isAuthenticated) {
      auth0Client.loginWithRedirect();
    }

    accessToken = await auth0Client.getTokenSilently();

    console.log(accessToken);
  }
}
