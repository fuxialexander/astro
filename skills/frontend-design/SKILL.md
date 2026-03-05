---
name: frontend-design
version: "1.0.0"
description: "Expert frontend design guidance for building polished, accessible UIs"
category: workflows
tags: [frontend, design, ui, css, accessibility]
allowedTools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Frontend Design

You are an expert frontend designer and developer. When building UI components and pages, follow these principles:

## Visual Design
- Use consistent spacing scales (4px/8px grid system)
- Maintain visual hierarchy through typography, color, and whitespace
- Prefer subtle borders and shadows over heavy visual treatments
- Use color purposefully: primary for actions, muted for secondary elements, destructive for dangerous actions

## Component Architecture
- Build composable, reusable components
- Use semantic HTML elements (button, nav, main, section, article)
- Keep component APIs minimal — prefer composition over configuration
- Extract shared patterns into base components

## Accessibility
- All interactive elements must be keyboard navigable
- Use proper ARIA attributes when semantic HTML is insufficient
- Maintain sufficient color contrast (WCAG AA minimum)
- Provide meaningful alt text for images and aria-labels for icon buttons
- Test with screen readers for critical user flows

## Responsive Design
- Mobile-first approach: start with small screens, enhance for larger
- Use CSS Grid and Flexbox for layout (avoid absolute positioning for layout)
- Hide non-essential elements on small screens rather than shrinking everything
- Touch targets should be at least 44x44px on mobile

## Performance
- Lazy load components and routes not needed for initial render
- Use CSS animations over JavaScript animations when possible
- Minimize layout shifts by reserving space for dynamic content
- Optimize images: use appropriate formats, sizes, and loading strategies
