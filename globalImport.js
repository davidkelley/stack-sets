const response = require("cfn-response");
const AWS = require("aws-sdk");
exports.handler = (event, context) => {
  const { SourceRegion, Exports = ['.+'] } = event.ResourceProperties;
  const filters = Exports.map(e => new RegExp(e, 'i'));
  const id = `custom:cloudformation:${SourceRegion}:exports`;
  const cloudformation = new AWS.CloudFormation({ region: SourceRegion });
  try {
    cloudformation.listExports({}, (err, data) => {
      if (err) {
        throw err;
      } else {
        const obj = {};
        data.Exports.forEach(({ Name, Value }) => {
          const matches = filters.filter(f => f.test(Name));
          if (matches.length > 0) obj[Name] = Value;
        });
        response.send(event, context, response.SUCCESS, obj, id);
      }
    });
  } catch (err) {
    console.error(err.message);
    response.send(event, context, response.FAILED, {}, id);
  }
};
