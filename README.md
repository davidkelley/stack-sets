# Stack Sets

[AWS CloudFormation Stack Sets](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-concepts.html) easily enable the global deployment of stacks across regions and accounts. This repo runs through bootstrapping a master organization with two (or possibly more) slave accounts, with a stack set instance deployed to each.

CloudFormation Stack Sets are deployed using the master account, with each account representing an isolation of resources, with individual regions within each account able to import each other's exported values using a global import custom CloudFormation resource. A region within each account is designated the "master" region and the others are "slaves".

### Terminology

**Master Account** - The account controlling the stack sets and instances deployed to separate accounts and regions within those accounts.
**Slave Account** - An account with instances of stack sets deployed to region(s) by the Master Account.
**Master Region** - A region within a Slave Account designated as the master. A master region can be used for globally unique resources, such as R53 Hosted Zones, etc.
**Slave Region** - A region within a Slave Account that has the same CloudFormation templates deployed to it, but often acts as a geographical localization of the Master Region.

_Note:_ It is important to understand that both **Master Regions** and **Slave Regions** have the same CloudFormation templates deployed to them. However, using [Conditions](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/conditions-section-structure.html) can behave differently, deploying different permissions and resources.

### Getting Started

First, lets assume that we have configured credentials for the master account and they live inside our `~/.aws/credentials` file like so:

```toml
[master]
region="us-east-1"
aws_access_key_id="XXXX"
aws_secret_access_key="YYYY"
```

Now, lets create a new slave account, using [AWS Organizations](https://aws.amazon.com/organizations/):

```bash
aws organizations create-account --email email+a@inbox.com --account-name "Slave A"
aws organizations create-account --email email+b@inbox.com --account-name "Slave B"
```

For each operation above, a response similar to the one below will be generated:

```json
{
  "CreateAccountStatus": {
    "State": "IN_PROGRESS",
    "Id": "car-examplecreateaccountrequestid111"
  }
}
```

Once each operation has completed, you can use the following command to retrieve the AWS Account Id's for the created Organization accounts, using the `"Id"` field returned from each of the preceeding commands.

```bash
aws organizations describe-create-account-status --create-account-request-id "car-examplecreateaccountrequestid111"
```

Now that we have two Account Id's, we can configure the AWS CLI to talk to each account, assuming the role that AWS Organizations [created for us](http://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies.html).

```toml
[master]
region="us-east-1"
aws_access_key_id="XXXX"
aws_secret_access_key="YYYY"

[master-slave-a]
role_arn="arn:aws:iam::<SLAVE A ACCOUNT ID>:role/OrganizationAccountAccessRole"
source_profile="master"

[master-slave-b]
role_arn="arn:aws:iam::<SLAVE B ACCOUNT ID>:role/OrganizationAccountAccessRole"
source_profile="master"
```

Your credentials file should now look similar to the above.

We now need to setup CloudFormation Stack Sets [IAM permissions](http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stacksets-prereqs.html#stacksets-prereqs-accountsetup), so that it has the correct authorization to create and manage sets in different accounts and regions. Let's execute the following commands:

```shell
aws --profile master cloudformation deploy --template-file master.yml --stack-name master --capabilities CAPABILITY_NAMED_IAM

aws --profile master-slave-a cloudformation deploy --template-file slave.yml --stack-name slave --parameter-overrides MasterAccountId=<MASTER ACCOUNT ID> --capabilities CAPABILITY_NAMED_IAM

aws --profile master-slave-b cloudformation deploy --template-file slave.yml --stack-name slave --parameter-overrides MasterAccountId=<MASTER ACCOUNT ID> --capabilities CAPABILITY_NAMED_IAM
```

Now, lets deploy our stack set. It is worth mentioning that "creating a stack set" isn't _actually_ deploying the template to any accounts or regions; it simply _uploads_ the template, configures parameters and determines capabilities. To create deployments, we create "instances" inside the stack set, which we'll get to in a moment.

```shell
aws --profile master cloudformation create-stack-set --stack-set-name global --template-body file://global.yml --parameters ParameterKey=Region,ParameterValue=us-east-1 --region us-east-1 --capabilities CAPABILITY_IAM
```

Finally, lets create some instances (_deployments.._) of our stack set inside our destination accounts and regions. We'll deploy to `us-east-1`, `eu-west-1` and `ap-southeast-2` regions in both slave accounts. The `MaxConcurrentPercentage=50` operation preference, speeds up the deployments by executing 3 stack creations concurrently (`3 regions * 2 accounts`)

```shell
aws --profile master cloudformation create-stack-instances --stack-set-name global --regions us-east-1 eu-west-1 ap-southeast-2 --accounts <SLAVE A ACCOUNT ID> <SLAVE B ACCOUNT ID> --operation-preferences MaxConcurrentPercentage=50
```

Once all the deployments have executed, you can begin to deploy additional stack sets for environment, infrastructure and service level CloudFormations, enabling you to implement regional conditions and global imports into your CloudFormation templates, such as:

```yaml
Conditions:

  IsMasterRegion: !Equals [ !Ref AWS::Region, !ImportValue MasterRegion ]

  IsSlaveRegion: !Not [ !Equals [ !Ref AWS::Region, !ImportValue MasterRegion ] ]

Resources:

  # Enables access to exported values in other regions. Particularly useful
  # for extracting exports only present in the Master Region, such as an AWS
  # ACM Certificate (ie. !GetAtt MasterRegion.ACMCertificateId) or even
  # the Master Region Hosted Zone ID.
  MasterRegion:
    Conditions: IsSlaveRegion
    Type: Custom::GlobalImports
    Properties:
      ServiceToken: !ImportValue GlobalImportValue
      SourceRegion: !ImportValue MasterRegion
```
