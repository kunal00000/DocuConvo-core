import { PineconeStore } from '@langchain/pinecone';

import { Index, Pinecone, RecordMetadata } from '@pinecone-database/pinecone';

import { DocMetadata } from '../types/docs.js';
import { prisma } from './db.js';
import { TaskType } from '@google/generative-ai';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import dotenv from 'dotenv';
dotenv.config();

export async function generateEmbeddings(
  dataset: DocMetadata[],
  {
    pineconeApiKey,
    pineconeEnvironment,
    pineconeIndexName,
    openaiApiKey,
    projectId,
  }: {
    pineconeApiKey: string;
    pineconeEnvironment: string;
    pineconeIndexName: string;
    openaiApiKey: string;
    projectId: string;
  }
) {
  try {
    const pinecone = new Pinecone({
      apiKey: pineconeApiKey,
    });

    const pineconeIndex = await pinecone.Index(pineconeIndexName);

    const embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: 'embedding-001',
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });

    const { isExist } = await checkIfEmbeddingsExist(
      pineconeIndex,
      embeddings,
      projectId
    );

    if (isExist) {
      // delete existing embeddings
      // TODO: Delete for same urls only not for all (org and project)
      // TODO: Filters in this operation are not supported 'Starter'
      // TODO: Switch to supabase or Use deleteAll for now (self-host)
      await pineconeIndex.deleteAll();
    }

    await PineconeStore.fromTexts(
      dataset.map((data) => {
        if (!data.text || data.text == '') return ' ';
        return data.text;
      }),
      dataset.map((data) => {
        return {
          url: data.url,
          project: projectId,
        };
      }),
      embeddings,
      { pineconeIndex }
    );

    await prisma.logMessage.create({
      data: {
        message: `✅ Stored vector embeddings successfully.`,
        projectId,
      },
    });
    return { success: true, message: 'Embeddings generated successfully' };
  } catch (error: any) {
    throw new Error(error.message);
    // return { success: false, message: 'Embeddings: ' + error.message }
  }
}

export async function checkIfEmbeddingsExist(
  pineconeIndex: Index<RecordMetadata>,
  embeddings: any,
  projectId: string
) {
  const { totalRecordCount } = await pineconeIndex.describeIndexStats();

  if (totalRecordCount && totalRecordCount > 0) {
    const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
    });

    const results = await vectorStore.similaritySearch('', 1000, {
      project: projectId,
    });

    if (results.length > 0) {
      return { isExist: true, count: results.length };
    }
  }
  return { isExist: false, count: 0 };
}
