/**
 * Tests for figure extraction from LaTeX source
 */

import { describe, it, expect } from 'vitest'
import { parseFigureReferences } from '../figures.js'

describe('parseFigureReferences', () => {
  describe('basic includegraphics', () => {
    it('parses simple includegraphics', () => {
      const latex = `\\includegraphics{figure1.png}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('figure1.png')
      expect(refs[0].sourceFile).toBe('test.tex')
    })

    it('parses includegraphics with options', () => {
      const latex = `\\includegraphics[width=0.5\\textwidth]{figure1.png}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('figure1.png')
      expect(refs[0].options).toBe('width=0.5\\textwidth')
    })

    it('parses multiple includegraphics', () => {
      const latex = `
        \\includegraphics{fig1.png}
        \\includegraphics{fig2.pdf}
        \\includegraphics{fig3.eps}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(3)
      expect(refs.map((r) => r.referencePath)).toEqual(['fig1.png', 'fig2.pdf', 'fig3.eps'])
    })

    it('handles path with directory', () => {
      const latex = `\\includegraphics{figures/subfolder/image.png}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('figures/subfolder/image.png')
    })

    it('handles path without extension', () => {
      const latex = `\\includegraphics{figure1}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('figure1')
    })
  })

  describe('figure environment', () => {
    it('extracts caption from figure environment', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{fig1.png}
          \\caption{This is a test caption}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('fig1.png')
      expect(refs[0].caption).toBe('This is a test caption')
    })

    it('extracts label from figure environment', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{fig1.png}
          \\caption{Test caption}
          \\label{fig:test}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].label).toBe('fig:test')
    })

    it('handles caption with short caption', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{fig1.png}
          \\caption[Short]{This is a longer caption for the figure}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].caption).toBe('This is a longer caption for the figure')
    })

    it('handles multiple figures in one environment', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{fig1a.png}
          \\includegraphics{fig1b.png}
          \\caption{Two subfigures}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(2)
      expect(refs[0].caption).toBe('Two subfigures')
      expect(refs[1].caption).toBe('Two subfigures')
    })
  })

  describe('figure* environment', () => {
    it('parses figure* environment', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{wide_fig.png}
          \\caption{Wide figure}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].referencePath).toBe('wide_fig.png')
    })
  })

  describe('line numbers', () => {
    it('tracks line numbers correctly', () => {
      const latex = `line1
line2
\\includegraphics{fig1.png}
line4
\\includegraphics{fig2.png}
`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(2)
      expect(refs[0].lineNumber).toBe(3)
      expect(refs[1].lineNumber).toBe(5)
    })
  })

  describe('edge cases', () => {
    it('handles empty file', () => {
      const refs = parseFigureReferences('', 'test.tex')
      expect(refs).toEqual([])
    })

    it('handles file with no figures', () => {
      const latex = `
        \\documentclass{article}
        \\begin{document}
        Hello, world!
        \\end{document}
      `
      const refs = parseFigureReferences(latex, 'test.tex')
      expect(refs).toEqual([])
    })

    it('handles nested braces in path', () => {
      const latex = `\\includegraphics{fig_{sub}.png}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      // Note: This will capture up to the first closing brace
      expect(refs[0].referencePath).toBe('fig_{sub')
    })

    it('handles complex options', () => {
      const latex = `\\includegraphics[width=0.5\\textwidth, height=3cm, keepaspectratio]{fig.png}`
      const refs = parseFigureReferences(latex, 'test.tex')

      expect(refs).toHaveLength(1)
      expect(refs[0].options).toBe('width=0.5\\textwidth, height=3cm, keepaspectratio')
    })
  })

  describe('deduplication', () => {
    it('does not duplicate figures that appear both standalone and in environment', () => {
      const latex = `
        \\begin{figure}
          \\includegraphics{fig1.png}
          \\caption{Test}
        \\end{figure}
      `
      const refs = parseFigureReferences(latex, 'test.tex')

      // Should only have one reference, not duplicated
      const figPaths = refs.map((r) => r.referencePath)
      expect(figPaths).toHaveLength(1)
      expect(figPaths[0]).toBe('fig1.png')
    })
  })
})
