# RxConnect Voice Agent Demo

A production ready voice AI agent that demonstrates real time conversational AI using **Deepgram** for speech processing on **AWS SageMaker**, **OpenAI** for language reasoning, and a custom **WebSocket orchestration layer**. The architecture is designed so that speech data can remain securely within an **AWS Virtual Private Cloud (VPC)** while still enabling low latency conversational interactions.

![Architecture](docs/architecture.png)



# Demo Video

This project showcases a **pharmacy voice assistant** built with Deepgram and deployed through AWS SageMaker.

The agent handles a complete customer support workflow through natural conversation.

During the demonstration the system performs the following steps:

1. Authenticates the caller using a Member ID  
2. Retrieves the correct prescription order  
3. Identifies the medication associated with the order  
4. Checks refill availability  
5. Provides the expected pickup time  

All steps are powered by **real time streaming speech recognition and conversational reasoning**, allowing the system to retrieve structured backend data while maintaining a natural dialogue.

[![Pharmacy Voice Agent Demo](https://img.youtube.com/vi/_Bm-nusSqHs/maxresdefault.jpg)](https://www.youtube.com/watch?v=_Bm-nusSqHs)



# How the Demo Works

| Step | Component | Description |
|-----|-----|-----|
| 1 | Input Audio | User speaks into a microphone. The browser streams 16 bit PCM audio through a WebSocket connection. |
| 2 | Deepgram Speech to Text | Audio is streamed to Deepgram Nova 3 through an AWS SageMaker bidirectional streaming endpoint. Deepgram Cloud can be used as a fallback option. |
| 3 | Language Model | The transcript is sent to OpenAI GPT 4o mini for reasoning and tool execution. |
| 4 | Backend Data | The model calls structured functions to retrieve order, medication, and refill data from the pharmacy database. |
| 5 | Deepgram Text to Speech | The system response is converted into natural speech using Deepgram Aura 2. |
| 6 | Output Audio | The synthesized audio is streamed back through the WebSocket and played in the browser. |



# Architecture Overview

The system architecture separates speech processing, reasoning, and user interaction into independent components.

- **Speech recognition** runs through AWS SageMaker so that incoming audio remains within the AWS VPC environment.
- **Speech synthesis** uses the Deepgram Cloud Text to Speech API. Only generated text is sent to the API, not user audio.
- **Language reasoning** is handled by OpenAI GPT 4o mini with structured function calling.
- Each browser connection receives an isolated **VoiceAgent session** with its own transcription stream, conversation state, and processing pipeline.



# What This Demonstrates

### Contact Centers

Enable real time voice agents that assist customers or augment human agents with live insights and guidance.

### Conversational Applications

Build interactive voice experiences that respond quickly and handle natural conversational flows.

### Data and Analytics

Process speech data immediately as it arrives instead of waiting for batch transcription jobs.

### Security and Compliance

Run speech recognition infrastructure inside AWS environments while maintaining enterprise security controls.



# Learning Objectives

This project demonstrates how to build a full voice AI pipeline with the following capabilities.

1. **Real Time Speech Recognition**  
   Transcribe user speech using Deepgram Nova 3 through AWS SageMaker bidirectional streaming.

2. **Language Model Integration**  
   Use OpenAI GPT 4o mini for conversational reasoning and function execution.

3. **Speech Synthesis**  
   Generate natural voice responses using Deepgram Aura 2.

4. **Voice Pipeline Orchestration**  
   Connect speech recognition, language reasoning, and speech synthesis within a single WebSocket session.

5. **Secure AWS Deployment**  
   Keep speech recognition workloads inside an AWS Virtual Private Cloud.



# Project Structure

```
rxconnect-voice-agent/
├── server/
│   ├── main.py
│   ├── requirements.txt
│   └── config/
│       ├── .env
│       ├── stt.py
│       ├── tts.py
│       └── llm.py
│
├── client/
│   ├── src/app/
│   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   ├── ConversationPanel.tsx
│   │   │   ├── DatabasePanel.tsx
│   │   │   └── useVoiceConnection.ts
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── public/
│   └── package.json
│
├── data/
│   └── pharmacy-order-data.json
│
└── README.md

```



# Quick Start

## Prerequisites

- Python 3.9 or later  
- Node.js 18 or later  
- Deepgram API Key  
- OpenAI API Key  
- AWS account with a SageMaker endpoint hosting the Deepgram Nova 3 model  

AWS credentials should be configured through environment variables or the `~/.aws/credentials` file.



# Installation

## Clone the Repository

```

git clone [https://github.com/deepgram/rxconnect-deepgram-pipecat-sagemaker-demo.git](https://github.com/deepgram/rxconnect-deepgram-pipecat-sagemaker-demo.git)
cd rxconnect-deepgram-pipecat-sagemaker-demo

```



## Backend Setup

```

cd server

python -m venv venv
source venv/bin/activate

pip install -r requirements.txt

```

Configure environment variables in `server/config/.env`.

```

DEEPGRAM_API_KEY=your_deepgram_key
OPENAI_API_KEY=your_openai_key

USE_SAGEMAKER_STT=true
SAGEMAKER_ENDPOINT_NAME=your-deepgram-endpoint
AWS_REGION=us-east-2
AWS_PROFILE=your-aws-profile

```

Start the backend server.

```

python main.py

```

The server will run at:

```

[http://localhost:8000](http://localhost:8000)

```



## Frontend Setup

```

cd client
npm install
npm run dev

```

The user interface will be available at:

```

[http://localhost:3000](http://localhost:3000)

```



# Testing the Voice Agent

1. Open `http://localhost:3000` in a browser.  
2. Select **Connect** to establish the WebSocket connection.  
3. The assistant will greet you automatically.  
4. Speak naturally to begin interacting with the system.



# Example Conversation

```

Agent: Hello. You are speaking with the virtual pharmacy assistant.
How may I help you today?

User: I would like to check my prescription order.

Agent: Certainly. Please provide your member identification number.

User: M 1 0 0 1

Agent: Thank you. I found order O R D 0 0 1, which is currently processing.

User: What medication is in that order?

Agent: Amoxicillin 500 milligrams, twenty one pills.

User: When will it be ready?

Agent: Your order will be ready for pickup on December twentieth at ten in the morning.

User: Do I have any refills?

Agent: You have zero refills remaining for prescription R X 1 0 0 1.

User: Thank you. Goodbye.

Agent: Thank you for calling. Goodbye.

```


# Security and Compliance

Deploying speech recognition through AWS SageMaker provides enterprise security controls.

| Feature | Benefit |
|------|------|
| Virtual Private Cloud Isolation | Speech data remains within the AWS network |
| No External Audio Transfer | Audio never leaves the customer environment |
| Identity and Access Management | Fine grained endpoint permissions |
| CloudTrail Logging | Auditable inference requests |
| Healthcare Compliance | Supports HIPAA eligible environments |
| Enterprise Security | SOC 2 compliant infrastructure |



# Technology Stack

| Layer | Technology | Role |
|------|------|------|
| Speech Recognition | Deepgram Nova 3 on SageMaker | Real time transcription |
| Transport | deepgram sagemaker | Streaming transport layer |
| Language Model | OpenAI GPT 4o mini | Conversational reasoning |
| Speech Synthesis | Deepgram Aura 2 | Natural voice generation |
| Backend | Python FastAPI WebSockets | Voice orchestration |
| Frontend | Next.js React Tailwind | Browser interface |
| Data | JSON | Pharmacy database |



## License

MIT License — Use this for learning and building your own voice agents!

## Resources

- [Deepgram Documentation](https://developers.deepgram.com)
- [Deepgram on AWS Marketplace](https://aws.amazon.com/marketplace/seller-profile?id=seller-k3ihfqamkbqps)
- [Amazon SageMaker](https://aws.amazon.com/sagemaker/)
- [Pipecat Framework](https://github.com/pipecat-ai/pipecat)
- [OpenAI API](https://platform.openai.com/docs)

