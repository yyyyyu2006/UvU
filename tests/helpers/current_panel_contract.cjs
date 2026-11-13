const assert=require('node:assert/strict');
async function openFilePreview(page){
 const more=page.locator('#shared-document-dialog .lenso-file-more');
 await more.locator(':scope > summary').click();
 await more.getByRole('button',{name:'预览正文',exact:true}).click();
}
async function assertNativeApiCard(page){
 const result=await page.locator('#minimax-tts-settings').evaluate(el=>{
  const peer=[...el.parentElement.querySelectorAll('.kkt-group')].find(node=>node!==el&&!el.contains(node)&&!node.contains(el)&&node.getClientRects().length);
  if(!peer)return null;
  const styles=node=>{const s=getComputedStyle(node);return{background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow,borderWidth:s.borderWidth,borderStyle:s.borderStyle};};
  return{actual:styles(el),native:styles(peer)};
 });
 assert.ok(result,'a visible native API card must be available for comparison');
 assert.deepEqual(result.actual,result.native,'MiniMax must use the surrounding native API card appearance');
}
module.exports={openFilePreview,assertNativeApiCard};
