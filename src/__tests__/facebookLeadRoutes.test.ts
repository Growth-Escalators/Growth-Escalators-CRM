import { describe, expect, it } from 'vitest';
import webhooksRouter from '../routes/webhooks';
import socialRouter from '../routes/social';

function routeExists(router: any, path: string, method: string) {
  return router.stack.some((layer: any) =>
    layer.route?.path === path && Boolean(layer.route.methods?.[method]),
  );
}

describe('Facebook Lead Form routes', () => {
  it('registers public Meta lead webhook routes', () => {
    expect(routeExists(webhooksRouter, '/meta-leads', 'get')).toBe(true);
    expect(routeExists(webhooksRouter, '/meta-leads', 'post')).toBe(true);
  });

  it('registers protected Social lead-form admin routes', () => {
    expect(routeExists(socialRouter, '/lead-forms/status', 'get')).toBe(true);
    expect(routeExists(socialRouter, '/lead-forms/accounts/:id/subscribe', 'post')).toBe(true);
  });
});
