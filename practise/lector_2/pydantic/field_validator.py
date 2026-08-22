from pydantic import BaseModel, EmailStr, AnyUrl, Field, field_validator, model_validator
from typing import Dict, List, Optional, Annotated

class Info(BaseModel):
    name: str = Field(max_length=10)
    email : EmailStr
    website : str
    weight: Optional[float]
    age: int 
    subjects : List[str]
    marks : Dict[str , int]

    @field_validator("email")
    @classmethod
    def email_validator(cls,value):
        domains = ["hdfc.com", "icici.com"]
        domain_name = value.split("@")[-1]
        if domain_name not in domains:
            raise ValueError("Not a valid domain")
        return
    
    @field_validator("name", mode="after")
    @classmethod
    def name_capitalizer(cls, value):
        new_value = value.upper()
        return new_value
    
    @field_validator("age", mode = "before")
    @classmethod
    def age_validator(cls, value):
        if 0< value <100:
            return value
        else:
            raise ValueError("Age should be in between 0 and 100")
        

info = {
    "name" : "Parmeet",
    "email" : "granthi.parmeet@icici.com",
    "age" : 54,
    "website" : "http://parmeetsingh.com",
    "weight": 89.32,
    "subjects" : ["math", "physics", "chemistry"],
    "marks" : {"math": 73, "physics" : 53, "chemistry":"83"}
}

info_un = Info(**info)

print(info_un.name)
print(info_un.email)
print(info_un.age)
print(info_un.website)
print(info_un.subjects)
print(info_un.marks)
print(info_un.weight)