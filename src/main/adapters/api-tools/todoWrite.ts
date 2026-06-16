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
    description: 'Track a concise task list for multi-step work. Use this when the task has several steps; do not use it for one-off answers.',
    inputSchema: z.object({
      todos: z.array(z.object({
        content: z.string().describe('Short task description.'),
        status: z.enum(['pending', 'in_progress', 'completed']).describe('Task status. Keep exactly one item in_progress when work is active.')
      })).describe('Full replacement todo list. Include all current items, not only changes.')
    }),
    execute: async (input: { todos: TodoItem[] }) => {
      todos = input.todos.map((todo) => ({ ...todo }))
      return todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`).join('\n')
    }
  })
}
