import type { Request, Response } from 'express'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { PineconeStore } from 'langchain/vectorstores/pinecone'
import { Configuration, OpenAIApi, ResponseTypes } from 'openai-edge'

import { Pinecone } from '@pinecone-database/pinecone'

export const searchQuery = async (req: Request, res: Response) => {
  const {
    pineconeApiKey,
    pineconeEnvironment,
    pineconeIndexName,
    openaiApiKey,
    projectId
  } = req.body

  const searchQuery = req.query.q as string

  try {
    const pinecone = new Pinecone({
      apiKey: pineconeApiKey,
      environment: pineconeEnvironment
    })
    const configuration = new Configuration({
      apiKey: openaiApiKey
    })
    const openai = new OpenAIApi(configuration)

    const pineconeIndex = await pinecone.Index(pineconeIndexName)

    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: openaiApiKey
    })

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex
    })

    // similar vectors
    const results = await vectorStore.similaritySearch(searchQuery, 2, {
      project: projectId
    })
    let contextText: string =
      results[0]?.pageContent.replace(/<[^>]*>?/gm, '') +
      ' ' +
      results[1]?.pageContent.replace(/<[^>]*>?/gm, '')

    //gpt 3.5 turbo
    const responseInitial = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: getInitialPrompt(searchQuery)
        }
      ],
      max_tokens: 512,
      temperature: 0
    })
    const dataInitial =
      (await responseInitial.json()) as ResponseTypes['createChatCompletion']

    const answerInitial = dataInitial.choices[0].message

    //gpt 3.5 turbo 1106
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo-1106',
      messages: [
        {
          role: 'user',
          content: getPrompt(searchQuery, answerInitial + contextText)
        }
      ],
      max_tokens: 512,
      temperature: 0
    })

    const data =
      (await response.json()) as ResponseTypes['createChatCompletion']

    const answer = data.choices[0].message

    return res.status(200).json({
      success: true,
      message: 'Query successful.',
      answer: answer?.content
    })
  } catch (err: any) {
    return res.status(404).json({
      success: false,
      message: `Something went wrong: ${err.message}.`,
      answer: null
    })
  }
}

const getPrompt = (query: string, context: string) => {
  return `
  ${`
  You are a highly dedicated representative of our tech company,
  committed to assisting and delighting our users. 
  Given the provided sections from the Organization
  documentation, please respond to the inquiry using
  only that information. In cases where the answer is not
  explicitly stated in the documentation,
  kindly express, "Sorry, I don't know how to help with that," 
  maintaining a professional and friendly tone.
  `}

  Context sections:
  ${context}

  Question: """
  ${query}
  """

  Answer as markdown (including related code snippets if available):
`
}

const getInitialPrompt = (query: string) => {
  return `
  ${`
  As a highly qualified employee in a tech company,
  explain the answer of Question in a way
  that is easily understandable for someone new to the topic.
  Provide concise explanations and practical insights to enhance comprehension.
  `}

  Question: """
  ${query}
  """
`
}