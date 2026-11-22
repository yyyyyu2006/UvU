// Loaded only when local metadata is explicitly read. No remote imports.
importScripts('music_metadata.js');
self.onmessage=async event=>{try{self.postMessage({result:await self.UvUMusicMetadata.parseFile(event.data.file)});}catch(_){self.postMessage({result:{}});}};
