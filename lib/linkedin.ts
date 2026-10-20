export async function publishMemberPost(
  accessToken: string,
  memberId: string,
  text: string,
) {
  const version = process.env.LINKEDIN_API_VERSION || '202610';

  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'LinkedIn-Version': version,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${memberId}`,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(
      `LinkedIn publish failed with HTTP status ${response.status}.`,
    );
  }

  const postUrn = response.headers.get('x-restli-id');

  if (!postUrn) {
    throw new Error(
      'LinkedIn returned success without a post identifier. Manual review is required.',
    );
  }

  return {
    status: response.status,
    postUrn,
  };
}

export async function getLinkedInUser(accessToken: string) {
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `LinkedIn userinfo failed with HTTP status ${response.status}.`,
    );
  }

  let user: {
    sub?: unknown;
    name?: unknown;
    email?: unknown;
  };

  try {
    user = await response.json();
  } catch {
    throw new Error('LinkedIn userinfo returned an invalid JSON response.');
  }

  if (typeof user.sub !== 'string' || !user.sub.trim()) {
    throw new Error(
      'LinkedIn userinfo response did not include a valid member identifier.',
    );
  }

  return {
    id: user.sub,
    name: typeof user.name === 'string' ? user.name : '',
    email: typeof user.email === 'string' ? user.email : '',
  };
}