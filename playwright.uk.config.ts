import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:'uk-smoke.spec.ts',workers:1,timeout:45000,
 expect:{timeout:10000},reporter:'list',
 use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:13021',locale:'en-GB',timezoneId:'Europe/London',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[
  {name:'laptop',use:{browserName:'chromium',viewport:{width:1280,height:800}}},
  {name:'iphone',use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  {name:'android',use:{browserName:'chromium',viewport:{width:360,height:800},isMobile:true,hasTouch:true}},
  {name:'foldable',use:{browserName:'chromium',viewport:{width:884,height:1104},hasTouch:true}},
  {name:'reflow',use:{browserName:'chromium',viewport:{width:320,height:740},hasTouch:true}},
 ]
});
