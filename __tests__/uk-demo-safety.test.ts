import {afterEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
afterEach(()=>{delete process.env.UK_DEMO_ONLY;vi.restoreAllMocks();});
describe('isolated UK evaluation boundary',()=>{
 it('blocks financial, AI, auth and notification endpoints without calling providers',()=>{
  process.env.UK_DEMO_ONLY='true';const fetch=vi.spyOn(globalThis,'fetch');
  for(const path of ['/api/data/rest/v1/accounts','/api/ai/demo-chat','/api/ai/demo-voice','/api/set-pin','/api/push/cron','/api/session'])
    expect(proxy(new NextRequest('http://localhost'+path,{method:'POST'})).status).toBe(403);
  expect(proxy(new NextRequest('http://localhost/demo',{method:'POST'})).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('serves no live quotes and preserves demo GET navigation',async()=>{
  process.env.UK_DEMO_ONLY='true';
  const response=proxy(new NextRequest('http://localhost/api/stocks?symbols=AAPL'));
  expect(await response.json()).toEqual({results:{},source:'offline-synthetic-demo',live:false});
  expect(proxy(new NextRequest('http://localhost/demo/accounts')).headers.get('x-middleware-next')).toBe('1');
  expect(proxy(new NextRequest('http://localhost/')).headers.get('location')).toBe('http://localhost/demo');
 });
});
