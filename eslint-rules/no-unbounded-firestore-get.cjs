module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow unbounded Firestore collection.get() queries',
    },
    schema: [],
    messages: {
      unboundedGet:
        'Use a bounded Firestore query before calling get() (for example: limit(), where(), startAfter(), startAt(), endBefore(), endAt(), or select()).',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const BOUNDING_CALLS = new Set([
      'limit',
      'where',
      'startAfter',
      'startAt',
      'endBefore',
      'endAt',
      'select',
      'findNearest',
    ]);

    function getMemberName(memberExpression) {
      if (memberExpression.property.type === 'Identifier') {
        return memberExpression.property.name;
      }
      if (
        memberExpression.property.type === 'Literal' &&
        typeof memberExpression.property.value === 'string'
      ) {
        return memberExpression.property.value;
      }
      return null;
    }

    function findVariable(scope, name) {
      let current = scope;
      while (current != null) {
        const variable = current.set.get(name);
        if (variable != null) {
          return variable;
        }
        current = current.upper;
      }
      return null;
    }

    function collectOperations(node, seenIdentifiers = new Set()) {
      if (node == null) {
        return [];
      }

      if (node.type === 'ChainExpression') {
        return collectOperations(node.expression, seenIdentifiers);
      }

      if (node.type === 'Identifier') {
        if (seenIdentifiers.has(node.name)) {
          return [];
        }

        const variable = findVariable(sourceCode.getScope(node), node.name);
        const definition = variable != null ? variable.defs[0] : null;
        if (
          definition != null &&
          definition.type === 'Variable' &&
          definition.node.type === 'VariableDeclarator' &&
          definition.node.init != null
        ) {
          const nextSeen = new Set(seenIdentifiers);
          nextSeen.add(node.name);
          return collectOperations(definition.node.init, nextSeen);
        }
        return [];
      }

      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const operations = collectOperations(node.callee.object, seenIdentifiers);
        const name = getMemberName(node.callee);
        if (name != null) {
          operations.push(name);
        }
        return operations;
      }

      if (node.type === 'MemberExpression') {
        return collectOperations(node.object, seenIdentifiers);
      }

      return [];
    }

    function getTerminalReceiver(operations) {
      for (let index = operations.length - 1; index >= 0; index -= 1) {
        const name = operations[index];
        if (name === 'collection' || name === 'doc') {
          return { index, name };
        }
      }
      return null;
    }

    function hasBoundingCallAfter(operations, startIndex) {
      for (let index = startIndex + 1; index < operations.length; index += 1) {
        if (BOUNDING_CALLS.has(operations[index])) {
          return true;
        }
      }
      return false;
    }

    function isUnboundedCollectionGet(node) {
      const operations = collectOperations(node);
      const terminalReceiver = getTerminalReceiver(operations);
      if (terminalReceiver == null) {
        return false;
      }

      if (terminalReceiver.name === 'doc') {
        return false;
      }

      if (!operations.includes('collection')) {
        return false;
      }

      return !hasBoundingCallAfter(operations, terminalReceiver.index);
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') {
          return;
        }

        const calleeName = getMemberName(node.callee);
        if (calleeName !== 'get') {
          return;
        }

        if (!isUnboundedCollectionGet(node.callee.object)) {
          return;
        }

        context.report({ node, messageId: 'unboundedGet' });
      },
    };
  },
};
