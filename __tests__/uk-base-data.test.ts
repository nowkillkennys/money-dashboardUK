import {describe,it,expect} from 'vitest';
import {getDemoMoneyData} from '../app/hooks/demo-data';
describe('selected UK fork defaults',()=>{
 it('uses GBP as the base of its synthetic account dataset',()=>{
  const data=getDemoMoneyData();
  expect(data.settings.base_currency).toBe('GBP');
  expect(data.accounts.some(account=>String(account.currency)==='GBP')).toBe(true);
 });
});
