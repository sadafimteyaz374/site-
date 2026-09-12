# 🏗️ SitePulse AI
### Autonomous Multi-Source Communication Triage & Risk Intelligence Engine

> **Live Demo:** [https://site-nine-navy-23.vercel.app](https://site-nine-navy-23.vercel.app)  
> **Backend Service:** [https://site-rtvd.onrender.com](https://site-rtvd.onrender.com)

---

## 🚀 Overview
**SitePulse AI** is an enterprise-grade, multi-source communication triage and risk intelligence platform engineered specifically for high-stakes operational environments like construction sites and project management. It ingests unstructured communications from diverse channels—including **Gmail APIs**, **Live WebRTC Team Meetings**, **AI-Powered Audio/Video Media Transcribers**, and **Manual Logs**—and automatically categorizes risk levels, computes financial exposure, and extracts actionable mitigation plans.

---

## 🛠️ Tech Stack & Architecture

* **Frontend:** React, Vite, TypeScript, Lucide React (Modern UI/UX)
* **Backend:** Node.js, WebServer/Signaling Server (Hosted on Render)
* **AI & Machine Learning:** Hugging Face Inference API (Whisper Model for Audio/Video-to-Text Transcription)
* **Integrations & Security:** Google OAuth 2.0 & Gmail REST API for secure direct inbox scanning
* **Deployment & Routing:** Vercel (SPA Routing with custom `vercel.json` rules)

---

## ✨ Key Features

1. **🔒 Secure User Gmail Integration (OAuth 2.0)**
   * Connects securely with Google accounts to fetch, parse, and triage critical job-related emails in real-time.
2. **🎙️ Real-Time Team Meeting & Signaling Room (WebRTC)**
   * Built-in WebRTC collaboration room that records live audio/video discussions, transcribes conversations, and instantly generates executive summaries and risk metrics.
3. **📁 Media Extractor (AI Audio/Video Transcription)**
   * Allows users to upload raw audio (`.mp3`, `.wav`) or video (`.mp4`) files. Automatically extracts audio tracks from video and leverages Hugging Face Whisper AI for precise speech-to-text processing.
4. **⚡ Autonomous Risk Intelligence Engine**
   * Computes automated **Risk Scores (0-100)**, categorizes severity levels (**Critical / Warning / Normal**), tracks financial exposure, and creates structured, accordion-style actionable mitigation plans with assigned owners and deadlines.

---

## ⚙️ Local Development & Setup

To run this project locally, follow these steps:

### 1. Clone the repository
\`\`\`bash
git clone https://github.com/your-username/site-pulse-ai.git
cd site-pulse-ai/site-pulse-app
\`\`\`

### 2. Install dependencies
\`\`\`bash
npm install
\`\`\`

### 3. Configure Environment Variables
Create a `.env` file in the root of your frontend directory and add your API tokens:
\`\`\`env
VITE_HF_API_TOKEN=your_huggingface_inference_api_token
VITE_SIGNALING_URL=https://site-rtvd.onrender.com
\`\`\`

### 4. Run the development server
\`\`\`bash
npm run dev
\`\`\`

---

## 💡 Architectural Highlights for Recruiters
* **Full-Stack Integration:** Seamlessly bridges a high-performance React frontend with a scalable Node.js backend on Render.
* **Complex Media Handling:** Handles browser-side binary audio extraction from video files before dispatching to external ML models.
* **Production-Ready Security:** Implements strict OAuth scopes and secure credential validation to prevent origin mismatch errors.

---
*Built with precision for scalable enterprise automation.*
