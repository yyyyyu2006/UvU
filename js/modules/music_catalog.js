/* Read-only views over the existing portable library; never writes user data. */
(function (root) {
    'use strict';
    const key = track => track.provider + ':' + track.id;
    function unique(tracks) {
        const seen = new Set();
        return tracks.filter(track => { const id = key(track); if (seen.has(id)) return false; seen.add(id); return true; });
    }
    const saved = lib => unique([...(lib.favorites || []), ...(lib.playlists || []).flatMap(item => item.tracks || [])]);
    const available = lib => unique([...(lib.recent || []), ...saved(lib)]);
    // Existing libraries append favorites and have no per-track addedAt field.
    // Newest favorites lead; playlist-only tracks use reverse insertion order as a fallback.
    const recentAdded = lib => unique([...(lib.favorites || [])].reverse().concat([...(lib.playlists || [])].reverse().flatMap(item => [...(item.tracks || [])].reverse())).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
    function groups(tracks, entries) {
        const values = new Map();
        for (const track of unique(tracks)) for (const [id, name] of entries(track)) {
            if (!values.has(id)) values.set(id, { id, name, tracks: [], cover: track.cover });
            values.get(id).tracks.push(track);
        }
        return [...values.values()];
    }
    const artists = tracks => groups(tracks, t => [...new Set(t.artists?.length ? t.artists : ['未知歌手'])].map(name => [name, name]));
    const albums = tracks => groups(tracks, t => [[t.album ? JSON.stringify([t.artists || [], t.album]) : key(t), t.album || t.title]]);
    function shuffled(items, random = Math.random) {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) { const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1)))); [result[i], result[j]] = [result[j], result[i]]; }
        return result;
    }
    // Two bounded searches; the connected source supplies all song metadata.
    function recommendationPlan(lib, random = Math.random) {
        const topics = shuffled(['华语流行', '独立音乐', '轻音乐', '爵士', '民谣', 'R&B', '古典', '摇滚'], random);
        const artist = shuffled(artists(available(lib)).filter(item => item.name !== '未知歌手'), random)[0];
        return [artist ? { query:artist.name, name:artist.name + '精选' } : { query:topics.pop(), name:'此刻想听' }, { query:topics[0], name:topics[0] + '精选' }];
    }
    function recommendations(lib, additions = [], random = Math.random) {
        const result = additions.filter(item => item.tracks?.length).map(item => ({ ...item, kind:'collection', tracks:shuffled(unique(item.tracks), random).slice(0,30) }));
        const tracks = shuffled(available(lib), random);
        if (tracks.length) result.push({ name:'为你混音', kind:'collection', tracks:tracks.slice(0,30), subtitle:'来自你的音乐' });
        for (const item of shuffled((lib.playlists || []).filter(item => item.tracks?.length), random).slice(0,3)) result.push({ ...item, subtitle:'你的歌单' });
        if (lib.favorites?.length) result.push({ name:'喜欢的旋律', kind:'collection', tracks:shuffled(unique(lib.favorites), random).slice(0,30), subtitle:'来自喜爱歌曲' });
        return result.slice(0,6).map(item => ({ ...item, cover:item.cover || item.tracks.find(track => track.cover)?.cover || '' }));
    }
    root.UvUMusicCatalog = { saved, available, recentAdded, artists, albums, unique, recommendationPlan, recommendations };
})(typeof window !== 'undefined' ? window : globalThis);
