function sanitize(v: string): string {
  let p = (v || '').trim().replace(/\.\./g, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return p || 'unknown'
}

export function dramaBaseKey(userId: string, dramaId: string): string {
  return `drama/${sanitize(userId)}/${sanitize(dramaId)}`
}

export function characterKey(userId: string, dramaId: string, characterId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/characters/${sanitize(characterId)}/${sanitize(filename)}`
}

export function sceneKey(userId: string, dramaId: string, sceneId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/scenes/${sanitize(sceneId)}/${sanitize(filename)}`
}

export function storyboardKey(userId: string, dramaId: string, episodeId: string, storyboardId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/episodes/${sanitize(episodeId)}/storyboards/${sanitize(storyboardId)}/${sanitize(filename)}`
}

export function episodeOutputKey(userId: string, dramaId: string, episodeId: string, filename: string): string {
  return `${dramaBaseKey(userId, dramaId)}/episodes/${sanitize(episodeId)}/output/${sanitize(filename)}`
}
