/**
 * Prefix-trie based autocomplete for slash commands.
 */

interface TrieNode {
  children: Map<string, TrieNode>
  isEnd: boolean
  value: string
}

export class PrefixTrie {
  private root: TrieNode

  constructor() {
    this.root = { children: new Map(), isEnd: false, value: '' }
  }

  insert(word: string): void {
    let node = this.root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map(), isEnd: false, value: '' })
      }
      node = node.children.get(char)!
    }
    node.isEnd = true
    node.value = word
  }

  search(prefix: string): string[] {
    let node = this.root
    for (const char of prefix) {
      if (!node.children.has(char)) return []
      node = node.children.get(char)!
    }
    return this.collect(node)
  }

  private collect(node: TrieNode): string[] {
    const results: string[] = []
    if (node.isEnd) results.push(node.value)
    for (const child of node.children.values()) {
      results.push(...this.collect(child))
    }
    return results
  }
}
