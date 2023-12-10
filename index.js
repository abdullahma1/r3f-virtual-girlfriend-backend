import { createContext, useContext, useEffect, useState } from "react";
import express from "express";
import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import OpenAI from "openai";
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from "fs";

dotenv.config();

const backendUrl = "http://localhost:3000";
const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "kgG7dCoKCfLehAPWkJOE";

const app = express();
app.use(express.json());
// app.use(cors({ origin: 'http://localhost:5173/', credentials: true }));

const port = 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

// Middleware to handle CORS
app.use(cors());

// Middleware to handle JSON parsing
app.use(express.json());

// Middleware to handle errors in async functions
const asyncMiddleware = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Convert audio to WAV format using FFmpeg
const convertAudio = async (inputFile, outputFile) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputFile)
      .toFormat('wav')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputFile);
  });
};

// Execute a command using child_process
const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, { env: { PATH: '/path/to/ffmpeg-directory:' + process.env.PATH } }, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

// Generate lipsync for a given message
const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(`ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`);
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(`./bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`);
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

// Read JSON transcript from a file
const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

// Convert audio file to base64
const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

// Route to get available voices
app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

// Route to handle chat messages
app.post("/chat", asyncMiddleware(async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    res.send({
      messages: [
        // ... your default messages
      ],
    });
    return;
  }

  if (!elevenLabsApiKey || openai.apiKey === "-") {
    res.send({
      messages: [
        // ... messages for missing API keys
      ],
    });
    return;
  }

  // OpenAI ChatGPT completion
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: `
        You are a virtual girlfriend.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
        `,
      },
      {
        role: "user",
        content: userMessage || "Hello",
      },
    ],
  });

  let messages = JSON.parse(completion.choices[0].message.content);

  if (messages.messages) {
    messages = messages.messages;
  }

  // Process and send messages
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const fileName = `audios/message_${i}.mp3`;
    const textInput = message.text;

    // Generate audio file
    await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);

    // Generate lipsync
    await lipSyncMessage(i);

    // Attach audio and lipsync to message
    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
  }

  res.send({ messages });
}));

// Start the server
app.listen(port, () => {
  console.log(`Virtual Talks listening on port ${port}`);
});
