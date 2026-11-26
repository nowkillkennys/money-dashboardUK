import {test,expect} from '@playwright/test';

test('UK synthetic overview and core account flows remain local and responsive',async({page},info)=>{
 const external:string[]=[],errors:string[]=[];
 const baseOrigin=new URL(info.config.projects[0].use.baseURL as string || process.env.PLAYWRIGHT_BASE_URL!).origin;
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['data:','blob:'].includes(url.protocol)&&url.origin!==baseOrigin){external.push(url.origin);return route.abort();}
  return route.continue();
 });
 await page.addInitScript(()=>localStorage.setItem('demo-tour-completed','true'));
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/demo');
 await expect(page.getByRole('heading',{name:'Overview',level:1})).toBeVisible();
 await expect(page.getByRole('note')).toContainText('Synthetic data only');
 await expect(page.getByText('Total net worth',{exact:true})).toBeVisible();
 await expect(page.getByRole('main')).toContainText('£');
 await expect(page.getByRole('heading',{name:'AI integrations disabled'})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:`test-results/uk-overview-${info.project.name}.png`,fullPage:false});
 for(const section of ['accounts','expenses','credit-cards','reports']){
  await page.goto('/demo/'+section);
  await expect(page.getByRole('main').getByRole('heading',{level:1}).first()).toBeVisible();
  await expect(page.getByRole('main')).toContainText('£');
 }
 await page.goto('/demo/chat');
 await expect(page.getByRole('heading',{name:'AI is disabled in this preview'})).toBeVisible();
 expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('evaluation API boundary blocks integrations and writes',async({request},info)=>{
 test.skip(info.project.name!=='laptop','One server-policy check is sufficient.');
 for(const path of ['/api/data/rest/v1/accounts','/api/ai/demo-chat','/api/ai/demo-voice','/api/set-pin','/api/push/cron','/demo'])
  expect((await request.post(path,{data:{synthetic:true}})).status()).toBe(403);
 expect((await request.get('/api/data/rest/v1/accounts')).status()).toBe(403);
 expect((await request.get('/sw.js')).status()).toBe(403);
 expect((await request.get('/_next/image?url=http://example.invalid/a.png&w=64&q=75')).status()).toBe(403);
 expect((await request.get('/api/stocks?symbols=AAPL')).status()).toBe(200);
 expect(await (await request.get('/api/stocks?symbols=AAPL')).json()).toEqual({results:{},source:'offline-synthetic-demo',live:false});
});
