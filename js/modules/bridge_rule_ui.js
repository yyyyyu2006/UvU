// Portable extraction presets are local preview tools; importing never approves a scene.
(function(root){
    'use strict';
    function mount(host){
        if(!host||document.getElementById('uvu-bridge-rule-preview'))return;
        const api=root.UvUBridgeText,node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
        const inspector=node('details'),title=node('summary','正文规则预览');inspector.id='uvu-bridge-rule-preview';inspector.append(title);
        const field=(label,element)=>{const row=node('label',label);element.setAttribute('aria-label',label);row.append(element);inspector.append(row);return element;};
        const saved=field('已保存规则',node('select')),name=field('规则名称',node('input'));name.maxLength=48;name.placeholder='例如：我的 content 预设';
        const preset=field('正文规则',node('select'));
        for(const [value,label]of [['auto','默认识别'],['content','content 优先'],['maintext','maintext 优先'],['chinese','正文 优先'],['custom','自定义优先']]){const o=node('option',label);o.value=value;preset.append(o);}
        const tags=field('自定义正文标签',node('input'));tags.placeholder='标签名称，不含尖括号';tags.maxLength=500;
        const excludes=field('排除标签',node('input'));excludes.placeholder='例如：extra 小剧场';excludes.maxLength=500;
        const tools=node('div');tools.className='uvu-bridge-actions';
        const result=node('pre');result.setAttribute('aria-live','polite');result.style.whiteSpace='pre-wrap';result.style.overflowWrap='anywhere';
        const fail=error=>result.textContent='操作失败：'+error.message;
        const action=(text,run)=>{const b=node('button',text);b.type='button';b.className='btn btn-secondary';b.onclick=()=>{try{run();}catch(error){fail(error);}};tools.append(b);return b;};
        const setCustom=()=>{tags.parentElement.hidden=preset.value!=='custom';};preset.onchange=setCustom;
        const render=(library,apply=false)=>{
            saved.replaceChildren();const blank=node('option','选择已保存规则');blank.value='';saved.append(blank);
            for(const rule of library.rules){const o=node('option',rule.name);o.value=rule.name;saved.append(o);}saved.value=library.selectedName;
            const rule=apply&&library.rules.find(r=>r.name===library.selectedName);
            if(rule){name.value=rule.name;preset.value=rule.preset;tags.value=rule.bodyTags;excludes.value=rule.excludeTags;}setCustom();
        };
        saved.onchange=()=>{try{render(api.selectRule(root.localStorage,saved.value),true);result.textContent='已载入本机预览规则';}catch(error){fail(error);}};
        action('保存规则',()=>{render(api.saveRule(root.localStorage,{name:name.value,preset:preset.value,bodyTags:preset.value==='custom'?tags.value:'',excludeTags:excludes.value}));result.textContent='规则已保存到当前浏览器';});
        action('删除规则',()=>{if(!saved.value)throw new Error('请先选择已保存规则');render(api.removeRule(root.localStorage,saved.value));result.textContent='规则已删除';});
        action('导出规则',()=>{const text=api.exportRules(root.localStorage);const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=node('a');a.href=url;a.download='uvu-body-rules.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);result.textContent='规则文件已导出';});
        const file=node('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.setAttribute('aria-label','导入正文规则文件');
        const importer=action('导入规则',()=>file.click());
        file.onchange=async()=>{const source=file.files?.[0];if(!source)return;importer.disabled=true;try{if(source.size>65536)throw new Error('正文规则文件过大（最多64 KiB）');const text=await source.text();render(api.importRules(root.localStorage,text),true);result.textContent='规则已导入；仅用于本机预览';}catch(error){fail(error);}finally{file.value='';importer.disabled=false;}};
        inspector.append(tools,file);
        const raw=field('检查剧情原文',node('textarea'));raw.rows=5;raw.maxLength=120000;raw.placeholder='粘贴一层楼的原文';
        const run=node('button','检查正文');run.type='button';run.className='btn btn-secondary';
        run.onclick=()=>{try{const report=api.previewRules(raw.value,preset.value,{bodyTags:tags.value,excludeTags:excludes.value});result.textContent=(report.mode==='malformed'?'标签未闭合，请核对':report.mode==='tagged'?'命中 '+report.tag:'未命中正文标签，需人工核对')+'\n过滤：'+(report.filteredTags.join('、')||'无')+'\n未知标签：'+(report.unknownTags.join('、')||'无')+'\n\n'+report.text;}catch(error){fail(error);}};
        const help=node('p','保存或导入仅改变本机预览。跨设备导出后再导入；酒馆插件仍需手动填写相同正文／排除标签。待审剧情和已存记忆不会被改写。');help.className='uvu-bridge-note';
        inspector.append(run,result,help);host.append(inspector);try{render(api.readRuleLibrary(root.localStorage),true);}catch(error){render({rules:[],selectedName:''});fail(error);}
    }
    root.UvUBridgeRuleUI={mount};
})(globalThis);
