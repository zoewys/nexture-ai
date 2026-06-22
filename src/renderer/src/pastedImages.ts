export async function savePastedImageFiles(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const data = await file.arrayBuffer()
      return window.api.savePastedImage({
        data,
        mediaType: file.type || 'image/png',
        name: file.name || undefined
      })
    })
  )
}

