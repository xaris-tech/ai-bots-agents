from __future__ import annotations

import logging

import requests

from .config import ApplicantProfile
from .models import JobPost

LOG = logging.getLogger("oljwatcher")


def build_application(job: JobPost, applicant: ApplicantProfile) -> str:
    skill_line = applicant.skills or "the skills required for this role"
    tools_line = applicant.tools or "the tools your team already uses"
    availability = applicant.availability or "I can adjust to the schedule needed for this role"
    portfolio = f"\nPortfolio: {applicant.portfolio}" if applicant.portfolio else ""
    rate = f"\nRate: {applicant.rate}" if applicant.rate else ""

    return (
        f"Hi,\n\n"
        f"I saw your post for {job.title} and I would like to apply. "
        f"My background is a strong fit because I have experience with {skill_line}. "
        f"I am comfortable working with {tools_line}, following documented processes, "
        f"communicating clearly, and taking ownership of recurring tasks without needing constant supervision.\n\n"
        f"Based on your job post, I can help with the main responsibilities described, keep work organized, "
        f"send clear updates, and make sure deadlines are met. {applicant.experience}\n\n"
        f"Availability: {availability}.{rate}{portfolio}\n\n"
        f"If you think I could be a good fit, I would be happy to answer questions, complete a short paid trial task, "
        f"or discuss how I can support your team.\n\n"
        f"Best,\n{applicant.name}"
    )


def build_ai_application(
    job: JobPost,
    applicant: ApplicantProfile,
    groq_api_key: str,
    model: str,
    style: str = "developer",
) -> str:
    if not groq_api_key:
        return build_application(job, applicant)

    prompt = _application_prompt(job, applicant, style)
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.35,
                "max_completion_tokens": 900,
                "messages": [
                    {
                        "role": "system",
            "content": (
                "You write concise, credible job applications for software developer, "
                "AI automation, no-code, and technical operator roles. Never invent "
                "specific employment history, degrees, certifications, or portfolio links. "
                "Use only the provided applicant facts. Sound human, specific, and confident. "
                "If the job post gives application instructions, follow them exactly when possible."
            ),
                    },
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=40,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        return content or build_application(job, applicant)
    except Exception as exc:
        LOG.warning("AI application generation failed, using fallback: %s", exc)
        return build_application(job, applicant)


def _application_prompt(job: JobPost, applicant: ApplicantProfile, style: str) -> str:
    skills = ", ".join(job.skills) if job.skills else "Not listed"
    return f"""
Create a high-converting OnlineJobs.ph application message for a {style} role.

Preferred structure:
1. Start with a subject line: "Subject: Application for [Job Title] - [short relevant angle]".
2. Open by saying you are interested in the exact job title and briefly mention that the role matches practical AI-assisted building / developer workflow work.
3. Use a short "My approach is simple:" section with 3 hyphen bullets:
   - Understand the business problem or workflow first
   - Build the smallest useful version quickly
   - Test, improve, and document the workflow
4. Add one short paragraph connecting the applicant to tools in the job post, especially CLI-based development, Claude Code, Codex, Lovable, Supabase, APIs, no-code/low-code, automation, debugging, testing, and documentation when relevant.
5. Include a practical first-week deliverable.
6. Close with a calm invitation to discuss the role.

Rules:
- 170 to 260 words.
- The first line must be the Subject line.
- Include exactly 3 short bullet points using hyphens.
- Read the full job details and follow any application instructions. For example, if they ask to mention specific experience level, availability, rate, a keyword, or answers to questions, include the known answer from applicant facts. If the answer is unknown, do not invent it.
- Mention relevant developer/AI tooling only if supported by the applicant profile or job post.
- Include one practical 7-day starter plan sentence.
- End with a confident call to action.
- No hype, no fake metrics, no fake portfolio, no overpromising.
- Avoid weak phrases like "I believe" and "positive impact".
- Make it sound like a capable technical operator who can clarify requirements, build, test, and document.
- Plain text only.

Job:
Title: {job.title}
URL: {job.url}
Posted: {job.posted_at}
Type: {job.job_type}
Salary: {job.salary}
Skills/tags: {skills}
Summary: {job.summary}
Full job details:
{job.detail or job.summary}

Applicant:
Name: {applicant.name}
Experience: {applicant.experience}
Skills: {applicant.skills}
Tools: {applicant.tools}
Availability: {applicant.availability}
Portfolio: {applicant.portfolio}
Rate: {applicant.rate}
""".strip()
