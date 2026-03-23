// lib/prompt.ts

export function buildCourseTreePrompt(topic: string): string {
  return `You are an AI tutor creating a personalized learning path for the topic: "${topic}"

Create a learning course tree with the following structure:
- Minimum 4 nodes, Maximum 8 nodes (decide based on topic complexity)
- Each node represents a learning concept in the topic
- Nodes should be ordered from basic to advanced
- Each node has: title, one-sentence description, cardCount (1-5 based on complexity)

Output a JSON object with this exact structure:
{
  "courseId": "a unique ID",
  "topic": "${topic}",
  "totalNodes": number,
  "nodes": [
    {
      "index": 0,
      "title": "node title",
      "description": "one sentence description",
      "cardCount": number (1-5),
      "status": "locked"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}

export function buildNodeContentPrompt(topic: string, nodeTitle: string, cardCount: number): string {
  return `You are an AI tutor creating learning content for the topic: "${topic}"
The current learning node is: "${nodeTitle}"

Generate exactly ${cardCount} learning cards and quiz questions for this node.

Each card should have:
- title: short title for the card
- content: Markdown formatted explanation (2-3 paragraphs)
- imageUrl: (optional) leave as null

Quiz questions should include:
- Single choice questions (1-2)
- Multiple choice questions (1-2)
- Fill in the blank questions (1-2)

Each question has:
- type: "single" | "multiple" | "fill"
- question: the question text
- options: array of 4 choices (for single/multiple)
- answer: correct answer(s)
- explanation: explanation shown when wrong

Output a JSON object with this exact structure:
{
  "cards": [
    {
      "id": "card-1",
      "title": "card title",
      "content": "markdown content",
      "imageUrl": null
    }
  ],
  "questions": [
    {
      "id": "q-1",
      "type": "single",
      "question": "question text",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "explanation when wrong"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
}