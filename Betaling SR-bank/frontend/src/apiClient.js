export function createApiClient(getAccessTokenSilently) {
  async function authFetch(input, init = {}) {
    const token = await getAccessTokenSilently();
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    return fetch(input, {
      ...init,
      headers,
    });
  }

  return { authFetch };
}
