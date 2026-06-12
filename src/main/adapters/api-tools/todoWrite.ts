import { tool } from 'ai'
import { z } from 'zod'

type TodoStatus = 'pending' | 'in_progress' | 'completed'
interface TodoItem {
  content: string
  status: TodoStatus
}

export function createTodoWriteTool() {
  let todos: TodoItem[] = []
  return tool({
    inputSchema: z.object({
      todos: z.array(z.object({
        content: z.string(),
        status: z.enum(['pending', 'in_progress', 'completed'])
      }))
    }),
    execute: async (input: { todos: TodoItem[] }) => {
      todos = input.todos.map((todo) => ({ ...todo }))
      return todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`).join('\n')
    }
  })
}
