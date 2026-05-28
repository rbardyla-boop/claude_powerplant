import Anthropic from '@anthropic-ai/sdk'

export async function downloadSessionOutput(client: Anthropic, fileId: string): Promise<string> {
  const response = await client.beta.files.download(fileId)
  return response.text()
}
