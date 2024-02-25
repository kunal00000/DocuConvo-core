import type { Request, Response } from 'express';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

import { Pinecone } from '@pinecone-database/pinecone';

export const searchQuery = async (req: Request, res: Response) => {
  const {
    pineconeApiKey,
    pineconeEnvironment,
    pineconeIndexName,
    openaiApiKey,
    projectId,
  } = req.body;

  const searchQuery = req.query.q as string;

  try {
    const pinecone = new Pinecone({
      apiKey: pineconeApiKey,
      environment: pineconeEnvironment,
    });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    const pineconeIndex = await pinecone.Index(pineconeIndexName);

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: 'embedding-001',
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });

    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
    });

    // similar vectors
    const results = await vectorStore.similaritySearch(searchQuery, 2, {
      project: projectId,
    });
    let contextText: string =
      results[0]?.pageContent.replace(/<[^>]*>?/gm, '') +
      ' ' +
      results[1]?.pageContent.replace(/<[^>]*>?/gm, '');

    console.log('contextText', contextText);
    // //gpt 3.5 turbo
    // const resultOne = await model.generateContent(
    //   getInitialPrompt(searchQuery)
    // );
    // const responseOne = await resultOne.response;

    // const answerInitial = responseOne.text();

    // console.log('answerInitial', answerInitial);

    //gpt 3.5 turbo 1106
    const resultTwo = await model.generateContent(
      getPrompt(searchQuery, contextText)
    );
    const responseTwo = await resultTwo.response;

    const answer = responseTwo.text();

    return res.status(200).json({
      success: true,
      message: 'Query successful.',
      answer: answer,
    });
  } catch (err: any) {
    return res.status(404).json({
      success: false,
      message: `Something went wrong: ${err.message}.`,
      answer: null,
    });
  }
};

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
`;
};

// const getInitialPrompt = (query: string) => {
//   return `
//   ${`
//   As a highly qualified employee in a tech company,
//   explain the answer of Question in a way
//   that is easily understandable for someone new to the topic.
//   Provide concise explanations and practical insights to enhance comprehension.
//   `}

//   Question: """
//   ${query}
//   """
// `;
// };
