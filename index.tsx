/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from '@google/genai';

// Fix: Define and use AIStudio interface for window.aistudio to resolve type conflict.
// Define the aistudio property on the window object for TypeScript
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

async function openApiKeyDialog() {
  if (window.aistudio?.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    // This provides a fallback for environments where the dialog isn't available
    showStatusError(
      'API key selection is not available. Please configure the API_KEY environment variable.',
    );
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      // Return only the Base64 part of the data URL
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const statusEl = document.querySelector('#status') as HTMLDivElement;
const loadingIndicator = document.querySelector(
  '#loading-indicator',
) as HTMLDivElement;
const progressBarFill = document.querySelector(
  '#progress-bar-fill',
) as HTMLDivElement;
const loadingText = document.querySelector('#loading-text') as HTMLSpanElement;

function updateProgress(percent: number, text?: string) {
  progressBarFill.style.width = `${percent}%`;
  if (text) loadingText.innerText = text;
}

async function generateContent(
  prompt: string,
  imageBytes: string,
  resolution: string,
  aspectRatio: string,
  apiKey: string,
) {
  const ai = new GoogleGenAI({ apiKey });

  const params: any = {
    model: 'veo-3.1-fast-generate-preview',
    prompt,
    config: {
      numberOfVideos: 1,
      resolution: resolution,
      aspectRatio: aspectRatio,
    },
  };

  if (imageBytes) {
    params.image = {
      imageBytes,
      mimeType: 'image/png', // Assuming PNG, adjust if supporting others
    };
  }

  updateProgress(5, 'Initializing model...');
  let operation = await ai.models.generateVideos(params);

  updateProgress(10, 'Creating video...');
  // Clear old status just in case
  statusEl.innerText = '';

  let pollCount = 0;
  const maxPolls = 20;
  while (!operation.done && pollCount < maxPolls) {
    pollCount++;
    console.log('Waiting for completion');

    // Update progress bar based on poll count to simulate progress
    const progress = 10 + Math.min(80, pollCount * 4); // Incrementally increase
    updateProgress(progress, 'Generating frames...');

    await delay(10000); // Poll every 10 seconds
    try {
      operation = await ai.operations.getVideosOperation({ operation });
    } catch (e) {
      console.error('Error polling for operation status:', e);
      throw new Error(
        'Failed to get video generation status. Please try again.',
      );
    }
  }

  if (!operation.done) {
    throw new Error(
      'Video generation timed out. Please try again with a simpler prompt.',
    );
  }

  const videos = operation.response?.generatedVideos;
  if (videos === undefined || videos.length === 0) {
    throw new Error(
      'No videos were generated. The prompt may have been blocked.',
    );
  }

  updateProgress(95, 'Downloading video...');

  for (const [i, v] of videos.entries()) {
    const url = decodeURIComponent(v.video.uri);
    // Append API key for access
    const res = await fetch(`${url}&key=${apiKey}`);
    const blob = await res.blob();
    const objectURL = URL.createObjectURL(blob);
    downloadFile(objectURL, `video${i}.mp4`);
    video.src = objectURL;
    console.log('Downloaded video', `video${i}.mp4`);
    video.style.display = 'block';
  }
  updateProgress(100, 'Done!');
}

// --- DOM Element Selection ---
const upload = document.querySelector('#file-input') as HTMLInputElement;
const promptEl = document.querySelector('#prompt-input') as HTMLTextAreaElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const video = document.querySelector('#video') as HTMLVideoElement;
const fileNameEl = document.querySelector('#file-name') as HTMLSpanElement;
const imgPreview = document.querySelector('#img-preview') as HTMLImageElement;
const resolutionSelect = document.querySelector(
  '#resolution-select',
) as HTMLSelectElement;
const styleSelect = document.querySelector(
  '#style-select',
) as HTMLSelectElement;
const aspectRatioSelect = document.querySelector(
  '#aspect-ratio-select',
) as HTMLSelectElement;

// --- State Variables ---
let base64data = '';
let prompt = '';

// --- Event Listeners ---
upload.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    fileNameEl.textContent = file.name;
    base64data = await blobToBase64(file);
    imgPreview.src = `data:image/png;base64,${base64data}`;
    imgPreview.style.display = 'block';
  } else {
    fileNameEl.textContent = 'No file chosen';
    base64data = '';
    imgPreview.style.display = 'none';
  }
});

promptEl.addEventListener('input', () => {
  prompt = promptEl.value;
});

generateButton.addEventListener('click', () => {
  if (!prompt.trim()) {
    showStatusError('Please enter a prompt to generate a video.');
    return;
  }
  generate();
});

// --- Functions ---
function showStatusError(message: string) {
  statusEl.innerHTML = `<span class="text-red-400">${message}</span>`;
}

function setControlsDisabled(disabled: boolean) {
  generateButton.disabled = disabled;
  upload.disabled = disabled;
  promptEl.disabled = disabled;
  resolutionSelect.disabled = disabled;
  styleSelect.disabled = disabled;
  aspectRatioSelect.disabled = disabled;
}

function showLoading(show: boolean) {
  if (show) {
    loadingIndicator.classList.remove('hidden');
    // Reset progress
    updateProgress(1, 'Starting generation...');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

async function generate() {
  const apiKey = process.env.API_KEY;
  const resolution = resolutionSelect.value;
  const style = styleSelect.value;
  const aspectRatio = aspectRatioSelect.value;

  if (!apiKey) {
    showStatusError('API key is not configured. Please add your API key.');
    await openApiKeyDialog();
    return;
  }

  statusEl.innerText = '';
  video.style.display = 'none';
  setControlsDisabled(true);
  showLoading(true);

  // Construct prompt with style
  let finalPrompt = prompt;
  const stylePrompts: Record<string, string> = {
    cinematic: ', cinematic, dramatic lighting, high quality, 4k',
    cartoon: ', cartoon style, vibrant colors, flat shading',
    anime: ', anime style, japanese animation, detailed',
    cyberpunk: ', cyberpunk style, neon lights, futuristic, high contrast',
    vintage: ', vintage 80s film look, grainy, vhs aesthetic',
    '3d-render': ', 3d render, unreal engine 5, octane render, photorealistic',
    watercolor: ', watercolor painting style, soft edges, artistic',
  };

  if (style !== 'none' && stylePrompts[style]) {
    finalPrompt += stylePrompts[style];
  }

  try {
    await generateContent(finalPrompt, base64data, resolution, aspectRatio, apiKey);
    statusEl.innerText = '';
  } catch (e) {
    console.error('Video generation failed:', e);
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.';

    let userFriendlyMessage = `Error: ${errorMessage}`;
    let shouldOpenDialog = false;

    if (typeof errorMessage === 'string') {
      if (errorMessage.includes('Requested entity was not found.')) {
        userFriendlyMessage =
          'Model not found. This can be caused by an invalid API key or permission issues. Please check your API key.';
        shouldOpenDialog = true;
      } else if (
        errorMessage.includes('API_KEY_INVALID') ||
        errorMessage.includes('API key not valid') ||
        errorMessage.toLowerCase().includes('permission denied')
      ) {
        userFriendlyMessage =
          'Your API key is invalid. Please add a valid API key.';
        shouldOpenDialog = true;
      }
    }

    showStatusError(userFriendlyMessage);

    if (shouldOpenDialog) {
      await openApiKeyDialog();
    }
  } finally {
    setControlsDisabled(false);
    showLoading(false);
  }
}