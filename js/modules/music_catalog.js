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
    root.UvUMusicCatalog = { saved, available, recentAdded, artists, albums, unique };
})(typeof window !== 'undefined' ? window : globalThis);
