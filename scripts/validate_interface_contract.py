#!/usr/bin/env python3
"""
Interface Contract Validation Tool

Validates interface contracts for fullstack sprints to prevent backend/frontend
integration mismatches.

Usage:
    python3 scripts/validate_interface_contract.py <contract_file>
    python3 scripts/validate_interface_contract.py --sprint <N>

Exit Codes:
    0: Contract is valid
    1: Validation failed
    2: Invalid arguments or file not found
"""

import json
import sys
import re
from pathlib import Path
from typing import Dict, List, Tuple, Any, Optional

try:
    import jsonschema

    HAS_JSONSCHEMA = True
except ImportError:
    HAS_JSONSCHEMA = False


class ContractValidationError(Exception):
    """Raised when contract validation fails."""

    pass


class InterfaceContractValidator:
    """Validates interface contracts against schema and business rules."""

    def __init__(self, schema_path: Optional[Path] = None):
        """
        Initialize validator with contract schema.

        Args:
            schema_path: Path to contract-schema.json (defaults to docs/contract-schema.json)
        """
        if schema_path is None:
            schema_path = Path(__file__).parent.parent / "docs" / "contract-schema.json"

        with open(schema_path) as f:
            self.schema = json.load(f)

    def validate(self, contract_path: Path) -> Tuple[bool, List[str]]:
        """
        Validate an interface contract file.

        Args:
            contract_path: Path to contract JSON file

        Returns:
            Tuple of (is_valid, error_messages)
        """
        errors = []

        try:
            # Load contract
            with open(contract_path) as f:
                contract = json.load(f)
        except FileNotFoundError:
            return False, [f"Contract file not found: {contract_path}"]
        except json.JSONDecodeError as e:
            return False, [f"Invalid JSON in contract file: {e}"]

        # Validate against JSON schema
        if HAS_JSONSCHEMA:
            try:
                jsonschema.validate(contract, self.schema)
            except jsonschema.ValidationError as e:
                errors.append(f"Schema validation failed: {e.message}")
                return False, errors
        else:
            # Manual validation when jsonschema not available
            schema_errors = self._validate_schema_manually(contract)
            if schema_errors:
                errors.extend(schema_errors)
                return False, errors

        # Skip validation for non-fullstack sprints
        if contract.get("type") != "fullstack":
            return True, []

        # Business rule validations
        errors.extend(self._validate_enum_case(contract))
        errors.extend(self._validate_type_matching(contract))
        errors.extend(self._validate_response_shapes(contract))
        errors.extend(self._validate_hook_naming(contract))

        return len(errors) == 0, errors

    def _validate_schema_manually(self, contract: Dict[str, Any]) -> List[str]:
        """
        Manual schema validation when jsonschema module not available.

        Args:
            contract: Contract dictionary

        Returns:
            List of error messages
        """
        errors = []

        # Check required fields
        if "sprint" not in contract:
            errors.append("Required field 'sprint' missing")
        elif not isinstance(contract["sprint"], int):
            errors.append("Field 'sprint' must be an integer")

        if "type" not in contract:
            errors.append("Required field 'type' missing")
        elif contract["type"] not in [
            "fullstack",
            "backend-only",
            "frontend-only",
            "integration",
            "data-layer",
        ]:
            errors.append(f"Invalid sprint type: {contract['type']}")

        if "backend_interface" not in contract:
            errors.append("Required field 'backend_interface' missing")

        if "frontend_interface" not in contract:
            errors.append("Required field 'frontend_interface' missing")

        return errors

    def _validate_enum_case(self, contract: Dict[str, Any]) -> List[str]:
        """
        Validate that all enum values are UPPERCASE.

        Args:
            contract: Contract dictionary

        Returns:
            List of error messages
        """
        errors = []
        backend = contract.get("backend_interface", {})
        enums = backend.get("enums", {})

        for enum_name, enum_values in enums.items():
            for value in enum_values:
                if not value.isupper():
                    errors.append(
                        f"Enum value '{value}' in enum '{enum_name}' must be UPPERCASE. "
                        f"Use '{value.upper()}' instead."
                    )

                # Check for valid enum value format (UPPERCASE with underscores)
                if not re.match(r"^[A-Z][A-Z0-9_]*$", value):
                    errors.append(
                        f"Enum value '{value}' in enum '{enum_name}' contains invalid characters. "
                        f"Use only UPPERCASE letters, numbers, and underscores."
                    )

        return errors

    def _validate_type_matching(self, contract: Dict[str, Any]) -> List[str]:
        """
        Validate that frontend types match backend types or enums.

        Args:
            contract: Contract dictionary

        Returns:
            List of error messages
        """
        errors = []
        backend = contract.get("backend_interface", {})
        frontend = contract.get("frontend_interface", {})

        # Collect backend type names
        backend_types = set(backend.get("types", {}).keys())
        backend_enums = set(backend.get("enums", {}).keys())
        all_backend_types = backend_types | backend_enums

        # Validate frontend types
        frontend_types = frontend.get("types", [])
        for frontend_type in frontend_types:
            if frontend_type not in all_backend_types:
                errors.append(
                    f"Frontend type '{frontend_type}' not defined in backend interface. "
                    f"Available backend types: {sorted(all_backend_types)}"
                )

        return errors

    def _validate_response_shapes(self, contract: Dict[str, Any]) -> List[str]:
        """
        Validate GraphQL response shapes match between backend and frontend.

        Validates that query return types are properly structured and nested
        types are fully defined.

        Args:
            contract: Contract dictionary

        Returns:
            List of error messages
        """
        errors = []
        backend = contract.get("backend_interface", {})

        # Validate queries have return types
        queries = backend.get("queries", {})
        for query_name, return_spec in queries.items():
            if not return_spec.startswith("returns:"):
                errors.append(
                    f"Query '{query_name}' return specification must start with 'returns:'. "
                    f"Got: '{return_spec}'"
                )
                continue

            # Extract return type from spec
            return_type = return_spec.replace("returns:", "").strip()
            errors.extend(self._validate_graphql_type(query_name, return_type, backend))

        # Validate mutations have return types
        mutations = backend.get("mutations", {})
        for mutation_name, return_spec in mutations.items():
            if not return_spec.startswith("returns:"):
                errors.append(
                    f"Mutation '{mutation_name}' return specification must start with 'returns:'. "
                    f"Got: '{return_spec}'"
                )
                continue

            return_type = return_spec.replace("returns:", "").strip()
            errors.extend(
                self._validate_graphql_type(mutation_name, return_type, backend)
            )

        # Validate nested type fields
        types = backend.get("types", {})
        for type_name, type_fields in types.items():
            errors.extend(self._validate_nested_type(type_name, type_fields, backend))

        return errors

    def _validate_graphql_type(
        self, field_name: str, graphql_type: str, backend: Dict[str, Any]
    ) -> List[str]:
        """
        Validate a GraphQL type reference.

        Args:
            field_name: Name of field being validated
            graphql_type: GraphQL type notation (e.g., '[Feature!]!', 'String')
            backend: Backend interface definition

        Returns:
            List of error messages
        """
        errors = []

        # Extract base type from GraphQL notation
        base_type = (
            graphql_type.replace("[", "").replace("]", "").replace("!", "").strip()
        )

        # Check if it's a scalar type
        scalar_types = {"String", "Int", "Float", "Boolean", "ID"}
        if base_type in scalar_types:
            return []

        # Check if it's a defined type or enum
        backend_types = set(backend.get("types", {}).keys())
        backend_enums = set(backend.get("enums", {}).keys())

        if base_type not in backend_types and base_type not in backend_enums:
            errors.append(
                f"Field '{field_name}' references undefined type '{base_type}'. "
                f"Define it in backend_interface.types or backend_interface.enums"
            )

        return errors

    def _validate_nested_type(
        self, type_name: str, type_fields: Dict[str, Any], backend: Dict[str, Any]
    ) -> List[str]:
        """
        Validate nested type definitions recursively.

        Args:
            type_name: Name of the type being validated
            type_fields: Field definitions for the type
            backend: Backend interface definition

        Returns:
            List of error messages
        """
        errors = []

        for field_name, field_def in type_fields.items():
            # Handle simple string type definition
            if isinstance(field_def, str):
                errors.extend(
                    self._validate_graphql_type(
                        f"{type_name}.{field_name}", field_def, backend
                    )
                )

            # Handle complex nested type definition
            elif isinstance(field_def, dict):
                field_type = field_def.get("type", "")
                errors.extend(
                    self._validate_graphql_type(
                        f"{type_name}.{field_name}", field_type, backend
                    )
                )

                # Recursively validate nested fields
                if "fields" in field_def:
                    nested_type_name = f"{type_name}.{field_name}"
                    errors.extend(
                        self._validate_nested_type(
                            nested_type_name, field_def["fields"], backend
                        )
                    )

        return errors

    def _validate_hook_naming(self, contract: Dict[str, Any]) -> List[str]:
        """
        Validate that React hooks follow naming conventions.

        Args:
            contract: Contract dictionary

        Returns:
            List of error messages
        """
        errors = []
        frontend = contract.get("frontend_interface", {})
        hooks = frontend.get("hooks", [])

        for hook_name in hooks:
            if not hook_name.startswith("use"):
                errors.append(
                    f"Hook '{hook_name}' must start with 'use' (React convention). "
                    f"Rename to 'use{hook_name[0].upper() + hook_name[1:]}'"
                )

            if not hook_name[3:4].isupper() if len(hook_name) > 3 else True:
                errors.append(
                    f"Hook '{hook_name}' must use camelCase with 'use' prefix. "
                    f"Fourth character should be uppercase."
                )

        return errors


def find_contract_for_sprint(sprint_num: int) -> Optional[Path]:
    """
    Find contract file for a given sprint number.

    Args:
        sprint_num: Sprint number

    Returns:
        Path to contract file, or None if not found
    """
    # Check in sprint directory
    sprint_dirs = list(Path("docs/sprints").glob(f"**/sprint-{sprint_num:02d}_*"))
    if not sprint_dirs:
        sprint_dirs = list(Path("docs/sprints").glob(f"**/sprint-{sprint_num}_*"))

    for sprint_dir in sprint_dirs:
        contract_file = sprint_dir / f"contract-sprint-{sprint_num}.json"
        if contract_file.exists():
            return contract_file

    # Check in .claude directory
    contract_file = Path(f".claude/sprint-{sprint_num}-contract.json")
    if contract_file.exists():
        return contract_file

    return None


def main():
    """Main entry point for contract validation."""
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/validate_interface_contract.py <contract_file>")
        print("   or: python3 scripts/validate_interface_contract.py --sprint <N>")
        sys.exit(2)

    # Parse arguments
    if sys.argv[1] == "--sprint":
        if len(sys.argv) < 3:
            print("Error: --sprint requires sprint number")
            sys.exit(2)

        try:
            sprint_num = int(sys.argv[2])
        except ValueError:
            print(f"Error: Invalid sprint number: {sys.argv[2]}")
            sys.exit(2)

        contract_path = find_contract_for_sprint(sprint_num)
        if contract_path is None:
            print(f"Error: No contract found for sprint {sprint_num}")
            print(
                f"Expected location: docs/sprints/**/sprint-{sprint_num:02d}_*/contract-sprint-{sprint_num}.json"
            )
            print(f"Alternative location: .claude/sprint-{sprint_num}-contract.json")
            sys.exit(1)
    else:
        contract_path = Path(sys.argv[1])

    # Validate contract
    validator = InterfaceContractValidator()
    is_valid, errors = validator.validate(contract_path)

    if is_valid:
        print(f"✓ Contract validation passed: {contract_path}")
        sys.exit(0)
    else:
        print(f"✗ Contract validation failed: {contract_path}")
        print("\nValidation errors:")
        for i, error in enumerate(errors, 1):
            print(f"  {i}. {error}")
        print("\nFix these errors and run validation again.")
        sys.exit(1)


if __name__ == "__main__":
    main()
