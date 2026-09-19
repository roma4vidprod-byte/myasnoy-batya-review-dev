// Diagnostic only, not a pagination engine or acceptance rule. No IO. Identities,
// property names and discriminator values stay in memory and are never returned.
import {normalizeYandexReview,diagnoseYandexReviewsPayload} from '../../providers/yandex.js';
import {fail} from './crypto.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
function shape(v,depth=0){
  if(depth>8)return type(v)+'_DEPTH_LIMIT';
  if(Array.isArray(v))return ['array',[...new Set(v.map(x=>JSON.stringify(shape(x,depth+1))))].sort()];
  if(object(v))return ['object',Object.keys(v).sort().map(k=>[k,shape(v[k],depth+1)])];
  return type(v);
}
const signature=v=>JSON.stringify(shape(v));
const required=['author','full_text','rating','time_created'];
const discriminators=['type','item_type','entity_type','kind'];
function analyze(payload,page,org){
  const list=payload?.list,pager=list?.pager;
  if(!object(payload)||Object.hasOwn(payload,'error')||Object.hasOwn(payload,'errors')||!object(list)||!object(pager)||!Array.isArray(list.items)||list.items.length>100)fail('YANDEX_CONTRACT_DRIFT');
  if(![pager.limit,pager.offset,pager.total].every(Number.isSafeInteger)||pager.limit!==20||pager.offset!==(page-1)*20||pager.total<pager.offset)fail('YANDEX_PAGINATION_CHANGED');
  const ids=new Set(),shapes=new Map(),discriminatorValues=Object.fromEntries(discriminators.map(k=>[k,new Set()]));
  let valid=0,missing=0,identityExtractable=0;
  for(const item of list.items){
    const sig=signature(item);shapes.set(sig,(shapes.get(sig)??0)+1);
    if(!object(item)||required.some(k=>!Object.hasOwn(item,k))||!Object.hasOwn(item,'id')&&!Object.hasOwn(item,'cmnt_entity_id')||
      object(item.author)&&!Object.hasOwn(item.author,'user')||
      object(item.owner_comment)&&['text','time_created','moderation_status'].some(k=>!Object.hasOwn(item.owner_comment,k)))missing++;
    if(object(item))for(const k of discriminators)if(Object.hasOwn(item,k))discriminatorValues[k].add(JSON.stringify(item[k]));
    try{
      const normalized=normalizeYandexReview(item,org);
      // Same stable provider/location/review identity as the accepted dedupe.
      ids.add(JSON.stringify([normalized.provider,normalized.externalLocationId,normalized.externalReviewId]));
      identityExtractable++;valid++;
    }catch(error){if(error?.code!=='YANDEX_CONTRACT_DRIFT')throw error;}
  }
  const diagnostic=diagnoseYandexReviewsPayload(payload,org);
  const expected=Math.min(pager.limit,pager.total-pager.offset);
  return {ids,shapes,discriminatorValues,topSignature:JSON.stringify(Object.keys(payload).sort().map(k=>[k,type(payload[k])])),
    pagerSignature:signature(pager),safe:{page,limit:pager.limit,offset:pager.offset,reported_total:pager.total,
      item_count:list.items.length,expected_item_count:expected,valid_review_count:valid,
      invalid_review_count:list.items.length-valid,missing_required_fields_count:missing,
      identity_extractable_valid_reviews:identityExtractable,unique_count:ids.size,duplicate_within_page_count:identityExtractable-ids.size,
      parser:diagnostic.ok?'PASS':'FAIL',contract_failure:diagnostic.contract_failure??null,
      top_level:diagnostic.schema.top_level_keys,top_level_unknown_keys:diagnostic.schema.unexpected_key_counts.top_level,
      containers:diagnostic.schema.container_types,pager_types:diagnostic.schema.pager_types}};
}
export function compareYandexBoundary(page3,page4,org){
  const a=analyze(page3,3,org),b=analyze(page4,4,org);
  const overlap=[...b.ids].filter(id=>a.ids.has(id)).length;
  const combined=new Set([...a.ids,...b.ids]).size;
  const classes=[...b.shapes.entries()].map(([sig,count],i)=>({class:`SHAPE_${i+1}`,count,seen_on_page3:a.shapes.has(sig)}));
  let normal=0;for(const [sig,count]of b.shapes)if(a.shapes.has(sig))normal+=count;
  const differentTypes=page4.list.items.filter(item=>object(item)&&discriminators.some(k=>Object.hasOwn(item,k)&&a.discriminatorValues[k].size>0&&!a.discriminatorValues[k].has(JSON.stringify(item[k])))).length;
  const uncomparableTypes=page4.list.items.filter(item=>object(item)&&discriminators.some(k=>Object.hasOwn(item,k)&&a.discriminatorValues[k].size===0)).length;
  const common=a.safe.parser==='PASS'&&a.safe.unique_count===a.safe.item_count&&a.safe.reported_total===b.safe.reported_total;
  const valid=common&&b.safe.valid_review_count===b.safe.item_count&&b.safe.unique_count===b.safe.item_count&&differentTypes===0&&uncomparableTypes===0;
  const extra=b.safe.item_count-b.safe.expected_item_count;
  let classification='G_UNKNOWN';
  if(valid&&b.safe.parser==='PASS'&&overlap===0)classification='E_TRANSIENT_PROVIDER_RESPONSE';
  else if(valid&&extra>0&&extra===overlap&&b.safe.unique_count-overlap===b.safe.expected_item_count)classification='A_BOUNDARY_DUPLICATE';
  else if(valid&&extra>0&&overlap===0)classification='C_TOTAL_IS_STALE_OR_INCONSISTENT';
  const result={classification,page3:a.safe,page4:{...b.safe,structural_classes:classes,shape_seen_on_page3_count:normal,
    alternate_shape_count:b.safe.item_count-normal,explicit_different_discriminator_count:differentTypes,
    uncomparable_discriminator_count:uncomparableTypes,
    discriminator_presence:Object.fromEntries(discriminators.map(k=>[k,{present:b.discriminatorValues[k].size>0,distinct_value_count:b.discriminatorValues[k].size}]))},
    boundary:{page3_unique_count:a.ids.size,page4_unique_count:b.ids.size,boundary_overlap_count:overlap,
      page4_new_unique_vs_page3:b.ids.size-overlap,combined_unique_count:combined,
      overlap_with_pages_1_2:'UNKNOWN_NOT_READ',overlap_with_pages_1_3:'UNKNOWN_NOT_RETAINED'},
    structure:{top_level_signature_match:a.topSignature===b.topSignature,pager_signature_match:a.pagerSignature===b.pagerSignature},
    parser_semantics:'UNCHANGED',full_completeness:'NOT_EVALUATED'};
  a.ids.clear();b.ids.clear();a.shapes.clear();b.shapes.clear();
  return result;
}
