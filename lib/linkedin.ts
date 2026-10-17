import { env } from '@/lib/env';

export async function publishMemberPost(accessToken: string, memberId: string, text: string) {
  const version = process.env.LINKEDIN_API_VERSION || '202610';
  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'LinkedIn-Version': version,
      'X-Restli-Protocol-Version': '2.0.0'
    },
    body: JSON.stringify({
      author: `urn:li:person:${memberId}`,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    }),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`LinkedIn publish failed (${response.status}): ${body.slice(0,1000)}`);
  return { status: response.status, postUrn: response.headers.get('x-restli-id'), responseBody: body.slice(0,1000) };
}

export async function getLinkedInUser(accessToken: string) {
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`LinkedIn userinfo failed (${response.status}): ${body.slice(0,500)}`);
  const user = JSON.parse(body);
  if (!user.sub) throw new Error('LinkedIn userinfo response did not include a member identifier.');
  return { id: String(user.sub), name: String(user.name ?? ''), email: String(user.email ?? '') };
}
