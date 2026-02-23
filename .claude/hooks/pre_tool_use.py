#!/usr/bin/env python3
"""
Claude Code PreToolUse Hook
Enhanced version with comprehensive agent context injection
Migrated from custom hook system (CLAUD-1)

Gates:
- Sprint completion: Blocks moves to 3-done/ unless /sprint-complete was run
"""
import json
import sys
import os
import subprocess
import re
from pathlib import Path

def main():
    # Read hook input from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("Error: Invalid JSON input", file=sys.stderr)
        sys.exit(1)

    tool_name = hook_data.get('tool_name', '')
    tool_input = hook_data.get('tool_input', {})
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))

    # Gate: Check sprint completion before allowing moves to 3-done/
    gate_result = check_sprint_completion_gate(tool_name, tool_input, project_root)
    if 'hookSpecificOutput' in gate_result:
        # Gate returned a denial - output it and exit
        print(json.dumps(gate_result))
        sys.exit(0)
    elif not gate_result.get('continue', True):
        print(json.dumps(gate_result))
        sys.exit(0)

    # Check if this is a Task tool invocation
    if tool_name != 'Task':
        # Not a Task tool call, continue normally
        sys.exit(0)

    # Set up Python path for imports
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
    sys.path.insert(0, str(project_root))
    sys.path.insert(0, str(project_root / 'src'))

    try:
        # Get task details
        tool_input = hook_data.get('tool_input', {})
        agent_type = tool_input.get('subagent_type', 'unknown')

        # Enhanced context preparation
        context = prepare_enhanced_context(project_root, agent_type)

        # Create comprehensive context message
        context_message = create_context_message(context, agent_type, tool_input, project_root)

        # Output comprehensive context
        print(json.dumps({
            "continue": True,
            "message": context_message
        }))

    except Exception as e:
        # Log error but don't block task
        print(json.dumps({
            "continue": True,
            "message": f"⚠️ Context injection failed: {e}"
        }))

def prepare_enhanced_context(project_root, agent_type):
    """Prepare comprehensive agent context (migrated from custom hook system)"""
    context = {}

    # Universal JIRA Manager
    try:
        from src.utils.jira_manager import get_default_universal_jira_manager
        ujm = get_default_universal_jira_manager()
        context['jira_manager'] = ujm.get_project_context()
    except Exception as e:
        context['jira_manager'] = {'error': str(e)}

    # Project tech stack detection
    context['tech_stack'] = detect_tech_stack(project_root)

    # Git context
    context['git_context'] = get_git_context(project_root)

    # Tool availability
    context['tool_availability'] = check_tool_availability()

    # File placement standards
    context['file_placement_standards'] = get_file_placement_standards(project_root, context['tech_stack'])

    # Quality gates configuration
    context['quality_gates'] = get_quality_gates_config(project_root)

    # Environment context
    context['environment'] = get_environment_context(project_root)

    return context

def create_context_message(context, agent_type, tool_input, project_root):
    """Create comprehensive context message for the agent"""
    jira_ctx = context.get('jira_manager', {})
    tech_stack = context.get('tech_stack', {})
    git_ctx = context.get('git_context', {})
    standards = context.get('file_placement_standards', {})
    tools = context.get('tool_availability', {})

    # Count available tools
    available_tools = [name for name, available in tools.items() if available]

    return f"""
🚀 **ENHANCED CONTEXT INJECTION FOR {agent_type.upper()} AGENT**

**Universal JIRA Manager**:
- Base URL: {jira_ctx.get('base_url', 'N/A')}
- Default Project: {jira_ctx.get('default_project_key', 'N/A')}
- Projects: {', '.join(jira_ctx.get('projects', []))}

**Project Tech Stack**:
- Languages: {', '.join(tech_stack.get('languages', ['unknown']))}
- Package Managers: {', '.join(tech_stack.get('package_managers', []))}
- Test Frameworks: {', '.join(tech_stack.get('test_frameworks', []))}

**Git Repository**:
- Is Git Repo: {git_ctx.get('is_git_repo', False)}
- Current Branch: {git_ctx.get('current_branch', 'unknown')}
- Working Directory Clean: {git_ctx.get('is_clean', False)}
- Has Remote: {git_ctx.get('has_remote', False)}

**File Placement Standards**:
- Source: {standards.get('source_dir', 'src')}/
- Tests: {standards.get('test_dir', 'tests')}/
- Scripts: {standards.get('scripts_dir', 'scripts')}/
- Docs: {standards.get('docs_dir', 'docs')}/
- Reports: {standards.get('reports_dir', 'test-reports')}/

**Available Tools** ({len(available_tools)} detected):
{', '.join(available_tools[:10])}{'...' if len(available_tools) > 10 else ''}

**Quality Standards for {agent_type}**:
✅ Follow detected file placement standards
✅ Use available tools for linting and testing
✅ Maintain Git best practices
✅ Update tests when modifying code

**JIRA Integration**:
```python
from src.utils.jira_manager import get_default_universal_jira_manager
ujm = get_default_universal_jira_manager()
# Pre-configured and ready to use
```

**Environment**: {context.get('environment', {}).get('environment', 'development')} | **CI**: {context.get('environment', {}).get('is_ci', False)}

---
**ORIGINAL TASK**: {tool_input.get('prompt', 'No prompt provided')}
""".strip()

def detect_tech_stack(project_root):
    """Detect project technology stack"""
    tech_stack = {
        'languages': [],
        'frameworks': [],
        'package_managers': [],
        'test_frameworks': []
    }

    # Python detection
    if (project_root / 'requirements.txt').exists() or (project_root / 'pyproject.toml').exists():
        tech_stack['languages'].append('python')
        tech_stack['package_managers'].append('pip')
        if (project_root / 'pytest.ini').exists():
            tech_stack['test_frameworks'].append('pytest')

    # Node.js detection
    if (project_root / 'package.json').exists():
        tech_stack['languages'].append('javascript')
        tech_stack['package_managers'].append('npm')
        tech_stack['test_frameworks'].append('jest')

    # Rust detection
    if (project_root / 'Cargo.toml').exists():
        tech_stack['languages'].append('rust')
        tech_stack['package_managers'].append('cargo')

    # Go detection
    if (project_root / 'go.mod').exists():
        tech_stack['languages'].append('go')
        tech_stack['package_managers'].append('go-mod')

    return tech_stack

def get_git_context(project_root):
    """Get comprehensive Git repository context"""
    git_context = {
        'is_git_repo': False,
        'current_branch': None,
        'is_clean': False,
        'has_remote': False,
        'remote_url': None
    }

    git_dir = project_root / '.git'
    if git_dir.exists():
        git_context['is_git_repo'] = True

        try:
            # Get current branch
            result = subprocess.run(
                ['git', 'branch', '--show-current'],
                capture_output=True, text=True, cwd=project_root
            )
            if result.returncode == 0:
                git_context['current_branch'] = result.stdout.strip()

            # Check if working directory is clean
            result = subprocess.run(
                ['git', 'status', '--porcelain'],
                capture_output=True, text=True, cwd=project_root
            )
            if result.returncode == 0:
                git_context['is_clean'] = len(result.stdout.strip()) == 0

            # Get remote URL
            result = subprocess.run(
                ['git', 'remote', 'get-url', 'origin'],
                capture_output=True, text=True, cwd=project_root
            )
            if result.returncode == 0:
                git_context['has_remote'] = True
                git_context['remote_url'] = result.stdout.strip()

        except Exception:
            pass

    return git_context

def check_tool_availability():
    """Check availability of development tools"""
    tools = {}
    tool_list = ['git', 'python3', 'python', 'pip', 'pip3', 'npm', 'cargo', 'go',
                 'ruff', 'mypy', 'pytest', 'black', 'isort', 'eslint', 'prettier', 'jest']

    for tool in tool_list:
        try:
            result = subprocess.run(['which', tool], capture_output=True, text=True)
            tools[tool] = result.returncode == 0
        except Exception:
            tools[tool] = False

    return tools

def get_file_placement_standards(project_root, tech_stack):
    """Setup file placement standards based on project structure"""
    standards = {
        'source_dir': 'src',
        'test_dir': 'tests',
        'scripts_dir': 'scripts',
        'docs_dir': 'docs',
        'config_dir': 'config',
        'reports_dir': 'test-reports'
    }

    # Detect actual project structure
    if (project_root / 'lib').exists() and not (project_root / 'src').exists():
        standards['source_dir'] = 'lib'

    if (project_root / '__tests__').exists():
        standards['test_dir'] = '__tests__'

    # Language-specific adjustments
    if 'javascript' in tech_stack.get('languages', []):
        if (project_root / 'public').exists():
            standards['public_dir'] = 'public'
        if (project_root / 'components').exists():
            standards['components_dir'] = 'components'

    return standards

def get_quality_gates_config(project_root):
    """Load quality gates configuration"""
    config = {
        'coverage_threshold': 80,
        'complexity_threshold': 10,
        'lint_enabled': True,
        'type_check_enabled': True
    }

    quality_file = project_root / '.quality-gates.yaml'
    if quality_file.exists():
        try:
            import yaml
            with open(quality_file, 'r') as f:
                custom_config = yaml.safe_load(f) or {}
            config.update(custom_config)
        except Exception:
            pass

    return config

def get_environment_context(project_root):
    """Load environment and CI/CD context"""
    env_context = {
        'is_ci': bool(os.getenv('CI')),
        'ci_provider': detect_ci_provider(),
        'environment': os.getenv('ENVIRONMENT', 'development'),
        'debug_mode': bool(os.getenv('DEBUG')),
        'test_mode': bool(os.getenv('TEST'))
    }

    # Load .env file if it exists
    env_file = project_root / '.env'
    if env_file.exists():
        env_context['env_file_path'] = str(env_file)
        try:
            with open(env_file, 'r') as f:
                env_vars = {}
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
                env_context['env_vars'] = env_vars
        except Exception:
            pass

    return env_context

def detect_ci_provider():
    """Detect CI/CD provider from environment variables"""
    ci_providers = {
        'GITHUB_ACTIONS': 'github-actions',
        'GITLAB_CI': 'gitlab-ci',
        'JENKINS_URL': 'jenkins',
        'TRAVIS': 'travis-ci',
        'CIRCLECI': 'circle-ci',
        'BUILDKITE': 'buildkite'
    }

    for env_var, provider in ci_providers.items():
        if os.getenv(env_var):
            return provider

    return None


# =============================================================================
# SPRINT COMPLETION GATE
# Blocks improper sprint file moves and state file manipulation
# =============================================================================

def deny_with_reason(reason: str) -> dict:
    """Return a properly formatted denial response for PreToolUse hooks."""
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }

def is_valid_done_destination(path: str) -> bool:
    """Check if path is a valid destination for completed sprints."""
    # Valid patterns:
    # - docs/sprints/3-done/_standalone/sprint-N_*--done.md
    # - docs/sprints/3-done/epic-N/sprint-N_*--done.md
    valid_patterns = [
        r'docs/sprints/3-done/_standalone/sprint-\d+.*--done\.md',
        r'docs/sprints/3-done/epic-\d+/sprint-\d+.*--done\.md',
    ]
    for pattern in valid_patterns:
        if re.search(pattern, path):
            return True
    return False

def is_invalid_done_folder(path: str) -> bool:
    """Check if path targets an invalid 'done' folder (like 4-done, 5-done, etc.)."""
    # Block any folder that looks like N-done except 3-done
    invalid_pattern = r'docs/sprints/[0-24-9]-done'
    return bool(re.search(invalid_pattern, path))

def check_sprint_completion_gate(tool_name, tool_input, project_root):
    """
    Enhanced gate that prevents improper sprint file operations.

    Blocks:
    1. Moving sprint files to wrong folders (4-done, 5-done, etc.)
    2. Moving sprint files without --done suffix
    3. Moving to 3-done/ without proper completion checklist
    4. Direct state file edits that bypass workflow

    Allows if:
    - State file exists with status='complete' and checklist passed
    - Destination is valid (3-done/_standalone/ or 3-done/epic-N/)
    - File has --done suffix
    """
    sprint_number = None
    is_move_operation = False
    is_state_file_edit = False
    destination_path = None

    # Check Bash mv/git mv commands
    if tool_name == 'Bash':
        command = tool_input.get('command', '')

        # Check for sprint file moves
        if ('mv ' in command or 'git mv ' in command) and 'sprint-' in command:
            match = re.search(r'sprint-(\d+)', command)
            if match:
                sprint_number = match.group(1)
                is_move_operation = True
                destination_path = command

                # GATE 1: Block moves to invalid folders (4-done, 5-done, etc.)
                if is_invalid_done_folder(command):
                    return deny_with_reason(
                        f"SPRINT MOVE BLOCKED: Sprint {sprint_number} cannot be moved to invalid folder. "
                        f"Only '3-done/' is valid for completed sprints. "
                        f"Use `/sprint-complete {sprint_number}` to properly complete the sprint."
                    )

                # GATE 2: If moving to any done folder, validate destination format
                if '3-done' in command or 'done' in command.lower():
                    if not is_valid_done_destination(command):
                        return deny_with_reason(
                            f"SPRINT MOVE BLOCKED: Invalid destination for Sprint {sprint_number}. "
                            f"Completed sprints must go to:\n"
                            f"  - docs/sprints/3-done/_standalone/sprint-N_*--done.md (standalone)\n"
                            f"  - docs/sprints/3-done/epic-N/sprint-N_*--done.md (in epic)\n"
                            f"Use `/sprint-complete {sprint_number}` to properly complete the sprint."
                        )

    # Check Edit/Write operations on sprint files in done folders
    elif tool_name in ('Edit', 'Write'):
        file_path = tool_input.get('file_path', '')

        # Check for state file manipulation
        if 'sprint-' in file_path and '-state.json' in file_path:
            match = re.search(r'sprint-(\d+)', file_path)
            if match:
                sprint_number = match.group(1)
                is_state_file_edit = True
                content = tool_input.get('content', '') or tool_input.get('new_string', '')

                # GATE 3: Block direct status changes to 'complete'
                # (only 'completing' is allowed during /sprint-complete flow)
                if '"status": "complete"' in content or "'status': 'complete'" in content:
                    # Check if this is a legitimate completion (checklist passed)
                    state_file = project_root / '.claude' / f'sprint-{sprint_number}-state.json'
                    if state_file.exists():
                        try:
                            with open(state_file, 'r') as f:
                                current_state = json.load(f)
                            # Only allow if currently in 'completing' status
                            if current_state.get('status') != 'completing':
                                return deny_with_reason(
                                    f"STATE FILE BLOCKED: Cannot directly set Sprint {sprint_number} status to 'complete'. "
                                    f"Current status: {current_state.get('status')}. "
                                    f"Use `/sprint-complete {sprint_number}` to properly complete the sprint."
                                )
                        except:
                            pass

        # Check for edits to files in done folders
        if '3-done' in file_path and 'sprint-' in file_path:
            match = re.search(r'sprint-(\d+)', file_path)
            if match:
                sprint_number = match.group(1)
                # Allow edits only if sprint is properly completed

    # If no sprint operation detected, allow
    if not sprint_number:
        return {"continue": True}

    # Skip further checks for state file edits (handled above)
    if is_state_file_edit:
        return {"continue": True}

    # For move operations and edits to 3-done, verify completion status
    state_file = project_root / '.claude' / f'sprint-{sprint_number}-state.json'

    if not state_file.exists():
        return deny_with_reason(
            f"SPRINT COMPLETION GATE: Cannot move Sprint {sprint_number} - "
            f"no state file found. Run `/sprint-complete {sprint_number}` first."
        )

    try:
        with open(state_file, 'r') as f:
            state = json.load(f)

        # Check if pre-flight checklist was completed
        checklist = state.get('pre_flight_checklist', {})
        status = state.get('status', '')

        # Allow if status is 'complete' or 'completing' and checklist shows completion
        required_checks = [
            'tests_passing',
            'sprint_file_updated',
            'no_hardcoded_secrets',
        ]
        # Note: git_status_clean removed from required - it's often false during completion

        checks_passed = all(checklist.get(check) for check in required_checks)

        if status in ('complete', 'completing') and checks_passed:
            # Sprint was properly completed, allow the operation
            return {"continue": True}

        # Not properly completed
        failed_checks = [check for check in required_checks if not checklist.get(check)]

        return deny_with_reason(
            f"SPRINT COMPLETION GATE: Sprint {sprint_number} not properly completed. "
            f"Status: {status}. Failed checks: {', '.join(failed_checks) if failed_checks else 'checklist not run'}. "
            f"Run `/sprint-complete {sprint_number}` first."
        )

    except (json.JSONDecodeError, IOError) as e:
        return deny_with_reason(
            f"SPRINT COMPLETION GATE: Could not read state file for Sprint {sprint_number}: {e}. "
            f"Run `/sprint-complete {sprint_number}` first."
        )


if __name__ == "__main__":
    main()
