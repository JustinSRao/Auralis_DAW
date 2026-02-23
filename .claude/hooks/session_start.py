#!/usr/bin/env python3
"""
Claude Code Session Start Hook
Enhanced version with comprehensive project context initialization
Migrated from custom hook system (CLAUD-1)
"""
import json
import sys
import os
import subprocess
from pathlib import Path

def main():
    # Read hook input from stdin
    try:
        hook_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("Error: Invalid JSON input", file=sys.stderr)
        sys.exit(1)

    # Set up Python path for imports
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
    sys.path.insert(0, str(project_root))
    sys.path.insert(0, str(project_root / 'src'))

    try:
        # Initialize comprehensive project context
        project_context = initialize_project_context(project_root)

        # Create enhanced context message
        context_message = create_session_message(project_context, project_root)

        # Output success
        print(json.dumps({
            "continue": True,
            "message": context_message
        }))

    except Exception as e:
        # Log error but don't block session
        error_msg = f"Warning: Failed to initialize project context: {e}"
        print(json.dumps({
            "continue": True,
            "message": f"⚠️ {error_msg}"
        }))

def initialize_project_context(project_root):
    """Initialize comprehensive project context at session start"""
    context = {}

    # Universal JIRA Manager
    try:
        from src.utils.jira_manager import get_default_universal_jira_manager
        ujm = get_default_universal_jira_manager()
        context['jira'] = ujm.get_project_context()
    except Exception as e:
        context['jira'] = {'error': str(e)}

    # Project detection
    context['tech_stack'] = detect_project_tech_stack(project_root)
    context['git'] = get_git_status(project_root)
    context['tools'] = check_development_tools()
    context['structure'] = analyze_project_structure(project_root)

    return context

def create_session_message(context, project_root):
    """Create comprehensive session start message"""
    jira_ctx = context.get('jira', {})
    tech_stack = context.get('tech_stack', {})
    git_ctx = context.get('git', {})
    tools = context.get('tools', {})
    structure = context.get('structure', {})

    available_tools = [name for name, available in tools.items() if available]

    return f"""
🚀 **ENHANCED PROJECT CONTEXT INITIALIZED**

**Universal JIRA Manager**:
- Status: {'✅ Ready' if 'error' not in jira_ctx else '❌ Error'}
- Base URL: {jira_ctx.get('base_url', 'N/A')}
- Default Project: {jira_ctx.get('default_project_key', 'N/A')}
- Projects: {', '.join(jira_ctx.get('projects', []))}

**Project Analysis**:
- Root: {project_root}
- Languages: {', '.join(tech_stack.get('languages', ['unknown']))}
- Package Managers: {', '.join(tech_stack.get('package_managers', []))}
- Test Frameworks: {', '.join(tech_stack.get('test_frameworks', []))}

**Git Repository**:
- Status: {'✅ Git repo' if git_ctx.get('is_repo') else '❌ Not a Git repo'}
- Branch: {git_ctx.get('branch', 'unknown')}
- State: {'Clean' if git_ctx.get('is_clean') else 'Modified files present'}

**Project Structure**:
- Source: {structure.get('source', 'src')}/
- Tests: {structure.get('tests', 'tests')}/
- Scripts: {structure.get('scripts', 'scripts')}/
- Docs: {structure.get('docs', 'docs')}/

**Development Tools** ({len(available_tools)} available):
{', '.join(available_tools[:8])}{'...' if len(available_tools) > 8 else ''}

**Session Features**:
✅ Enhanced context injection for all Task tool usage
✅ Automatic tech stack detection and standards
✅ Git-aware file placement recommendations
✅ Quality gates and best practices enforcement

**Ready for Task tool invocations with full context injection!**
""".strip()

def detect_project_tech_stack(project_root):
    """Detect project technology stack and frameworks"""
    tech_stack = {
        'languages': [],
        'frameworks': [],
        'package_managers': [],
        'test_frameworks': []
    }

    # Python detection
    if (project_root / 'requirements.txt').exists() or (project_root / 'pyproject.toml').exists():
        tech_stack['languages'].append('Python')
        tech_stack['package_managers'].append('pip')

        # Check for specific Python frameworks
        if (project_root / 'manage.py').exists():
            tech_stack['frameworks'].append('Django')
        elif any((project_root / f).exists() for f in ['app.py', 'main.py', 'server.py']):
            tech_stack['frameworks'].append('FastAPI/Flask')

        if (project_root / 'pytest.ini').exists() or (project_root / 'setup.cfg').exists():
            tech_stack['test_frameworks'].append('pytest')

    # Node.js detection
    if (project_root / 'package.json').exists():
        tech_stack['languages'].append('JavaScript/TypeScript')
        tech_stack['package_managers'].append('npm')

        # Check package.json for frameworks
        try:
            import json
            with open(project_root / 'package.json', 'r') as f:
                pkg_data = json.load(f)
                deps = {**pkg_data.get('dependencies', {}), **pkg_data.get('devDependencies', {})}

                if 'react' in deps:
                    tech_stack['frameworks'].append('React')
                if 'next' in deps:
                    tech_stack['frameworks'].append('Next.js')
                if 'vue' in deps:
                    tech_stack['frameworks'].append('Vue.js')
                if 'jest' in deps:
                    tech_stack['test_frameworks'].append('Jest')
        except:
            pass

    # Rust detection
    if (project_root / 'Cargo.toml').exists():
        tech_stack['languages'].append('Rust')
        tech_stack['package_managers'].append('Cargo')
        tech_stack['test_frameworks'].append('cargo test')

    # Go detection
    if (project_root / 'go.mod').exists():
        tech_stack['languages'].append('Go')
        tech_stack['package_managers'].append('go mod')
        tech_stack['test_frameworks'].append('go test')

    # Java detection
    if (project_root / 'pom.xml').exists():
        tech_stack['languages'].append('Java')
        tech_stack['package_managers'].append('Maven')
        tech_stack['frameworks'].append('Maven')
    elif (project_root / 'build.gradle').exists():
        tech_stack['languages'].append('Java/Kotlin')
        tech_stack['package_managers'].append('Gradle')
        tech_stack['frameworks'].append('Gradle')

    return tech_stack

def get_git_status(project_root):
    """Get Git repository status and information"""
    git_status = {
        'is_repo': False,
        'branch': 'unknown',
        'is_clean': False,
        'has_remote': False
    }

    git_dir = project_root / '.git'
    if git_dir.exists():
        git_status['is_repo'] = True

        try:
            # Get current branch
            result = subprocess.run(
                ['git', 'branch', '--show-current'],
                capture_output=True, text=True, cwd=project_root, timeout=5
            )
            if result.returncode == 0:
                git_status['branch'] = result.stdout.strip()

            # Check if working directory is clean
            result = subprocess.run(
                ['git', 'status', '--porcelain'],
                capture_output=True, text=True, cwd=project_root, timeout=5
            )
            if result.returncode == 0:
                git_status['is_clean'] = len(result.stdout.strip()) == 0

            # Check for remote
            result = subprocess.run(
                ['git', 'remote'],
                capture_output=True, text=True, cwd=project_root, timeout=5
            )
            if result.returncode == 0:
                git_status['has_remote'] = len(result.stdout.strip()) > 0

        except (subprocess.TimeoutExpired, Exception):
            pass

    return git_status

def check_development_tools():
    """Check availability of common development tools"""
    tools = {}
    tool_list = [
        'git', 'python3', 'python', 'pip', 'pip3', 'node', 'npm', 'yarn',
        'cargo', 'go', 'java', 'javac', 'mvn', 'gradle',
        'ruff', 'mypy', 'pytest', 'black', 'isort', 'flake8',
        'eslint', 'prettier', 'jest', 'tsc'
    ]

    for tool in tool_list:
        try:
            result = subprocess.run(['which', tool], capture_output=True, text=True, timeout=2)
            tools[tool] = result.returncode == 0
        except (subprocess.TimeoutExpired, Exception):
            tools[tool] = False

    return tools

def analyze_project_structure(project_root):
    """Analyze project directory structure"""
    structure = {
        'source': 'src',
        'tests': 'tests',
        'scripts': 'scripts',
        'docs': 'docs',
        'config': 'config'
    }

    # Check for alternative structures
    if (project_root / 'lib').exists() and not (project_root / 'src').exists():
        structure['source'] = 'lib'
    elif (project_root / 'source').exists() and not (project_root / 'src').exists():
        structure['source'] = 'source'

    if (project_root / '__tests__').exists():
        structure['tests'] = '__tests__'
    elif (project_root / 'test').exists() and not (project_root / 'tests').exists():
        structure['tests'] = 'test'

    if (project_root / 'documentation').exists() and not (project_root / 'docs').exists():
        structure['docs'] = 'documentation'

    return structure

if __name__ == "__main__":
    main()
