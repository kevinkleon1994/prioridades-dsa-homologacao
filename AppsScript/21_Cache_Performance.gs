/** Prioridades DSA v1.11 R2 — utilitários de CacheService */
function cacheJsonGet_(key){try{const raw=CacheService.getScriptCache().get(String(key));return raw?JSON.parse(raw):null}catch(_e){return null}}
function cacheJsonPut_(key,value,seconds){try{CacheService.getScriptCache().put(String(key),JSON.stringify(value),Math.max(1,Math.min(Number(seconds||60),21600)))}catch(_e){}}
function cacheJsonRemove_(key){try{CacheService.getScriptCache().remove(String(key))}catch(_e){}}
function cacheJsonRemoveAll_(keys){try{CacheService.getScriptCache().removeAll((keys||[]).map(String))}catch(_e){}}
